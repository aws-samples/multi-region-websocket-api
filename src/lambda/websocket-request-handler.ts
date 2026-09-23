import generateLambdaProxyResponse from './utils';

import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

import AWSXRay from 'aws-xray-sdk-core';
const eventBridge = AWSXRay.captureAWSv3Client(new EventBridgeClient({
  region: process.env.AWS_REGION,
}));

export async function handleMessage(event: any) {
  console.log('Received WebSocket message', {
    eventType: event.requestContext?.eventType,
    routeKey: event.requestContext?.routeKey,
    requestId: event.requestContext?.requestId,
    messageLength: typeof event.body === 'string' ? event.body.length : 0,
  });

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

  console.log('Publishing chat message', {
    eventBusName: process.env.BUS_NAME,
    detailType: entry.DetailType,
  });

  const result = await eventBridge.send(new PutEventsCommand({
    Entries: [entry],
  }));

  console.log('Published chat message', {
    failedEntryCount: result.FailedEntryCount ?? 0,
  });

  return generateLambdaProxyResponse(200, 'Ok');
}
