import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApi } from '@aws-sdk/client-apigatewaymanagementapi';

const AWSXRay = require('aws-xray-sdk-core');

const client = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const dynamoDbClient = DynamoDBDocumentClient.from(client);

const gatewayClient = new ApiGatewayManagementApi({
  apiVersion: '2018-11-29',
  endpoint: process.env.API_GATEWAY_ENDPOINT,
});

interface ResponseEventDetails {
  message: string;
  senderConnectionId: string;
  chatId: string;
}

async function getConnections(senderConnectionId: string, chatId: string): Promise<any> {
  const { Items: connections } = await dynamoDbClient.send(new QueryCommand({
    TableName: process.env.TABLE_NAME!,
    KeyConditionExpression: 'chatId = :c',
    ExpressionAttributeValues: {
      ':c': chatId,
    },
    ProjectionExpression: 'connectionId',
  }));

  return connections!
    .map((c: any) => c.connectionId)
    .filter((connectionId: string) => connectionId !== senderConnectionId);
}

export async function handler(event: EventBridgeEvent<'EventResponse', ResponseEventDetails>): Promise<any> {
  console.log('Triggered by ', event);
  const connections = await getConnections(event.detail.senderConnectionId, event.detail.chatId);
  console.log('Found connections in this region ', connections);
  const postToConnectionPromises = connections
    .map((connectionId: string) => gatewayClient.postToConnection({
      ConnectionId: connectionId,
      Data: JSON.stringify({ data: event.detail.message }),
    }));
  await Promise.allSettled(postToConnectionPromises!);
  return true;
}
