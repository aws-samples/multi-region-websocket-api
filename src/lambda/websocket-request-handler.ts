import generateLambdaProxyResponse from './utils';

const AWSXRay = require('aws-xray-sdk-core');
const AWS = AWSXRay.captureAWS(require('aws-sdk'));

const eventBridge = new AWS.EventBridge({
  region: process.env.AWS_REGION,
});

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

  const result = await eventBridge.putEvents({
    Entries: [entry],
  }).promise();

  console.log('Result ', result);

  return generateLambdaProxyResponse(200, 'Ok');
}
