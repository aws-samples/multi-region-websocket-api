#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Tags } from 'aws-cdk-lib';
import { WebsocketsBlogStack } from '../lib/websockets-blog-stack';

const app = new cdk.App();

const regionsToDeploy = ['us-west-1', 'eu-west-1', 'ap-northeast-1'];

// Regional stacks
regionsToDeploy.forEach((regionCode) => {
  const stack = new WebsocketsBlogStack(app, `WebsocketsBlogStack-${regionCode}`, {
    env: { region: regionCode },
    regionCodesToReplicate: regionsToDeploy.filter((replicationRegion) => replicationRegion !== regionCode),
  });
  Tags.of(stack).add('project', 'aws-blogpost');
  Tags.of(stack).add('topic', 'multi-region-websocket-api');
});
