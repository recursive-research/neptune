import msg from 'inpage/messages'
import { InjectedNeptuneProvider } from './provider'
import { rpcMiddleware } from './rpc/middleware'
import { initRpcIntercept } from './rpc/intercept'

// provider injects itself, no need to attach to window.ethereum
export const provider = new InjectedNeptuneProvider({ rpcMiddleware })

initRpcIntercept()

msg.forkRpcUrl.onChanged(async () => {
  if (await msg.connection.get()) window.location.reload()
})

msg.sync.sync()
