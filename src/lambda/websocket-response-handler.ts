import { EventBridgeEvent } from 'aws-lambda';

const AWSXRay = require('aws-xray-sdk-core');
const AWS = AWSXRay.captureAWS(require('aws-sdk'));

const dynamoDbClient = new AWS.DynamoDB.DocumentClient({
  apiVersion: '2012-08-10',
  region: process.env.AWS_REGION,
});

const gatewayClient = new AWS.ApiGatewayManagementApi({
  apiVersion: '2018-11-29',
  endpoint: process.env.API_GATEWAY_ENDPOINT,
});

interface ResponseEventDetails {
  message: string;
  senderConnectionId: string;
  chatId: string;
}

async function getConnections(senderConnectionId: string, chatId: string): Promise<any> {
  const { Items: connections } = await dynamoDbClient.query({
    TableName: process.env.TABLE_NAME!,
    KeyConditionExpression: 'chatId = :c',
    ExpressionAttributeValues: {
      ':c': chatId,
    },
    ProjectionExpression: 'connectionId',
  }).promise();

  return connections
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
    }).promise());
  await Promise.allSettled(postToConnectionPromises!);
  return true;
}
