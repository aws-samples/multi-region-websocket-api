import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApi } from '@aws-sdk/client-apigatewaymanagementapi';

import AWSXRay from 'aws-xray-sdk-core';

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
  const connections = await getConnections(event.detail.senderConnectionId, event.detail.chatId);
  console.log('Processing chat message', {
    eventType: event['detail-type'],
    connectionCount: connections.length,
  });

  const postToConnectionPromises = connections
    .map((connectionId: string) => gatewayClient.postToConnection({
      ConnectionId: connectionId,
      Data: JSON.stringify({ data: event.detail.message }),
    }));
  const results = await Promise.allSettled(postToConnectionPromises);
  console.log('Delivered chat message', {
    connectionCount: connections.length,
    failedDeliveries: results.filter((result) => result.status === 'rejected').length,
  });
  return true;
}
