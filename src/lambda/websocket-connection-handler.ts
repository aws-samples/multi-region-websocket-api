import { DocumentClient } from 'aws-sdk/clients/dynamodb';
// eslint-disable-next-line import/no-unresolved
import { APIGatewayEvent } from 'aws-lambda';

import generateLambdaProxyResponse from './utils';

const AWSXRay = require('aws-xray-sdk-core');
const AWS = AWSXRay.captureAWS(require('aws-sdk'));

const dynamoDbClient: DocumentClient = new AWS.DynamoDB.DocumentClient({
  apiVersion: '2012-08-10',
  region: process.env.AWS_REGION,
});

export async function connectionHandler(event: APIGatewayEvent): Promise<any> {
  const { eventType, connectionId } = event.requestContext;

  if (eventType === 'CONNECT') {
    const oneHourFromNow = Math.round(Date.now() / 1000 + 3600);
    await dynamoDbClient.put({
      TableName: process.env.TABLE_NAME!,
      Item: {
        connectionId,
        chatId: 'DEFAULT',
        ttl: oneHourFromNow,
      },
    }).promise();
    return generateLambdaProxyResponse(200, 'Connected');
  }

  if (eventType === 'DISCONNECT') {
    await dynamoDbClient.delete({
      TableName: process.env.TABLE_NAME!,
      Key: {
        connectionId,
        chatId: 'DEFAULT',
      },
    }).promise();

    return generateLambdaProxyResponse(200, 'Disconnected');
  }

  return generateLambdaProxyResponse(200, 'Ok');
}
