import generateLambdaProxyResponse from './utils';

import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

import AWSXRay from 'aws-xray-sdk-core';
const eventBridge = AWSXRay.captureAWSv3Client(new EventBridgeClient({
  region: process.env.AWS_REGION,
}));

export async function handleMessage(event: any) {
  const entry = {
    EventBusName: process.env.BUS_NAME,
    Source: 'ChatApplication',
    DetailType: 'ChatMessageReceived',
    Detail: JSON.stringify({
      message: event.body,
      chatId: 'DEFAULT',
      senderConnectionId: event.requestContext.connectionId,
    }),
  };

  await eventBridge.send(new PutEventsCommand({
    Entries: [entry],
  }));

  return generateLambdaProxyResponse(200, 'Ok');
}
