export default function generateLambdaProxyResponse(httpCode: number, jsonBody: string) {
  return {
    body: jsonBody,
    statusCode: httpCode,
  };
}
