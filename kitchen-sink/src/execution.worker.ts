import { executeSample, type ExecutionRequest } from "./execution";

self.onmessage = (event: MessageEvent<ExecutionRequest>) => {
  self.postMessage(executeSample(event.data));
};
