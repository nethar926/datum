/// <reference lib="webworker" />
import { SimHost } from './host'
import type { ToWorker } from './contract'

const scope = self as unknown as DedicatedWorkerGlobalScope
const host = new SimHost((msg, transfer) => scope.postMessage(msg, transfer ?? []))
scope.onmessage = (e: MessageEvent<ToWorker>) => host.handle(e.data)
