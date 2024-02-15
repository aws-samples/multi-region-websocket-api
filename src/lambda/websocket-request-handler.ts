import generateLambdaProxyResponse from './utils';

import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

const AWSXRay = require('aws-xray-sdk-core');
const eventBridge = AWSXRay.captureAWSv3Client(new EventBridgeClient({
  region: process.env.AWS_REGION,
}));

export async function handleMessage(event: any) {
  console.log('Received event ', event);

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

  console.log('Sending to EventBridge ', entry);

  const result = await eventBridge.send(new PutEventsCommand({
    Entries: [entry],
  }));

  console.log('Result ', result);

  return generateLambdaProxyResponse(200, 'Ok');
}
