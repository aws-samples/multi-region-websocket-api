import {
  CfnOutput, Duration, RemovalPolicy, Stack, StackProps,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { WebSocketLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as apigwv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import { Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import {
  Effect, PolicyStatement, Role, ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { EventBus, LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import path = require('path');

export interface SimpleLambdaProps {
  memorySize?: number;
  reservedConcurrentExecutions?: number;
  runtime?: Runtime;
  name: string;
  description: string;
  entryFilename: string;
  handler?: string;
  timeout?: Duration;
  envVariables?: any;
}

export class SimpleLambda extends Construct {
  public fn: NodejsFunction;

  constructor(scope: Construct, id: string, props: SimpleLambdaProps) {
    super(scope, id);

    this.fn = new NodejsFunction(this, id, {
      entry: `../src/lambda/${props.entryFilename}`,
      handler: props.handler ?? 'handler',
      runtime: props.runtime ?? Runtime.NODEJS_14_X,
      timeout: props.timeout ?? Duration.seconds(5),
      memorySize: props.memorySize ?? 1024,
      tracing: Tracing.ACTIVE,
      functionName: props.name,
      description: props.description,
      depsLockFilePath: path.join(__dirname, '..', '..', 'src', 'package-lock.json'),
      environment: props.envVariables ?? {},
    });
  }
}

interface WebSocketStackProps extends StackProps {
  regionCodesToReplicate: string[]
}

export class WebsocketsBlogStack extends Stack {
  constructor(scope: Construct, id: string, props: WebSocketStackProps) {
    super(scope, id, props);

    const table = new Table(this, 'WebsocketConnections', {
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      tableName: 'WebsocketConnections',
      partitionKey: {
        name: 'chatId',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'connectionId',
        type: AttributeType.STRING,
      },
    });
    // dedicated event bus
    const eventBus = new events.EventBus(this, 'EventBus', {
      eventBusName: 'ChatEventBus',
    });

    // (Dis-)connect handler
    const connectionLambda = new SimpleLambda(this, 'ConnectionHandlerLambda', {
      entryFilename: 'websocket-connection-handler.ts',
      handler: 'connectionHandler',
      name: 'ConnectionHandler',
      description: 'Handles the onConnect & onDisconnect events emitted by the WebSocket API Gateway',
      envVariables: {
        TABLE_NAME: table.tableName,
      },
    });
    table.grantFullAccess(connectionLambda.fn);

    // Main (default route) handler
    const requestHandlerLambda = new SimpleLambda(this, 'RequestHandlerLambda', {
      entryFilename: 'websocket-request-handler.ts',
      handler: 'handleMessage',
      name: 'RequestHandler',
      description: 'Handles requests sent via websocket and stores (connectionId, chatId) tuple in DynamoDB. Sends ChatMessageReceived events to EventBridge.',
      envVariables: {
        BUS_NAME: eventBus.eventBusName,
      },
    });

    eventBus.grantPutEventsTo(requestHandlerLambda.fn);

    const webSocketApi = new apigwv2.WebSocketApi(this, 'WebsocketApi', {
      apiName: 'WebSocketApi',
      description: 'A regional Websocket API for the multi-region chat application.',
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration('connectionIntegration', connectionLambda.fn),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('disconnectIntegration', connectionLambda.fn),
      },
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration('defaultIntegration', requestHandlerLambda.fn),
      },
    });

    const websocketStage = new apigwv2.WebSocketStage(this, 'WebsocketStage', {
      webSocketApi,
      stageName: 'chat',
      autoDeploy: true,
    });

    const processLambda = new SimpleLambda(this, 'ProcessEventLambda', {
      entryFilename: 'websocket-response-handler.ts',
      handler: 'handler',
      name: 'ProcessEvent',
      description: 'Gets invoked when a new "ChatMessageReceived" event is published to EventBridge. The function determines the connectionIds and pushes the message to the clients',
      envVariables: {
        TABLE_NAME: table.tableName,
        API_GATEWAY_ENDPOINT: websocketStage.callbackUrl,
      },
    });

    // Create policy to allow Lambda function to use @connections API of API Gateway
    const allowConnectionManagementOnApiGatewayPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${websocketStage.stageName}/*`,
      ],
      actions: ['execute-api:ManageConnections'],
    });

    // Attach custom policy to Lambda function
    processLambda.fn.addToRolePolicy(allowConnectionManagementOnApiGatewayPolicy);

    // An explicit, but empty IAM role is required.
    // Otherwise the CDK will overwrite permissions for implicit roles for each region.
    // This leads to only the last written IAM policy being set and thus restricting the rule to a single region.
    const crossRegionEventRole = new Role(this, 'CrossRegionRole', {
      inlinePolicies: {},
      assumedBy: new ServicePrincipal('events.amazonaws.com'),
    });

    // Generate list of Event buses in other regions
    const crossRegionalEventbusTargets = props.regionCodesToReplicate
      .map((regionCode) => new EventBus(events.EventBus.fromEventBusArn(
        this,
        `WebsocketBlogBus-${regionCode}`,
        `arn:aws:events:${regionCode}:${this.account}:event-bus/${eventBus.eventBusName}`,
      ), {
        role: crossRegionEventRole,
      }));

    new events.Rule(this, 'ProcessRequest', {
      eventBus,
      enabled: true,
      ruleName: 'ProcessChatMessage',
      description: 'Invokes a Lambda function for each chat message to push the event via websocket and replicates the event to event buses in other regions.',
      eventPattern: {
        detailType: ['ChatMessageReceived'],
        source: ['ChatApplication'],
      },
      targets: [
        new LambdaFunction(processLambda.fn),
        ...crossRegionalEventbusTargets,
      ],
    });

    eventBus.grantPutEventsTo(processLambda.fn);
    table.grantReadData(processLambda.fn);

    new CfnOutput(this, 'bucketName', {
      value: websocketStage.url,
      description: 'WebSocket API URL',
      exportName: `websocketAPIUrl-${this.region}`,
    });
  }
}
