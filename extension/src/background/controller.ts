import { defaultAccounts } from '../shared/constants/accounts'
import { Account, ChainId, Fork, RpcRequest } from '../shared/types'
import msg from './messages'
import url from './utils/url'
import { store } from './storage'
import { getAvailableForks } from 'shared/queries'
import { impersonateAll, forkMainnetLatest } from 'shared/mutations'

export class NeptuneController {
  private _baseUrl = new URL('http://localhost:1738')
  private _providerRpcUrl: URL | null = null
  private _accounts = defaultAccounts
  private _chainId: ChainId = '0x1'
  private _fork: Fork | null = null
  private _connectedTabs = new Set<number>()

  constructor() {
    // register get handlers
    msg.accounts.onGet(() => this.accounts)
    msg.chain.onGet(() => this.chainId)
    msg.baseUrl.onGet(() => this.baseUrl.toString())
    msg.connection.onGet(tab => this.isConnected(tab))
    msg.fork.onGet(() => this.fork)
    msg.forkRpcUrl.onGet(() => this.forkRpcUrl)
    msg.providerRpcUrl.onGet(() =>
      this.providerRpcUrl ? this.providerRpcUrl.toString() : null,
    )

    // register set handlers
    msg.chain.onSet(this.setChainId.bind(this))
    msg.baseUrl.onSet(this.setBaseUrl.bind(this))
    msg.providerRpcUrl.onSet(this.setProviderRpcUrl.bind(this))
    msg.accounts.onSet(this.setAccounts.bind(this))
    msg.fork.onSet(this.setFork.bind(this))
    msg.connection.onSet(({ connected, tabId }) =>
      connected ? this.connect(tabId) : this.disconnect(tabId),
    )

    // rpc request handler
    msg.rpc.onRequest(this.sendRpcRequest.bind(this))

    // side effects
    msg.sync.onSync(this.sync.bind(this))
  }

  /**
   * Initialize state from storage. If no fork is active
   * choose an available fork. If none or available, fork mainnet.
   */
  async init() {
    // init state from storage
    const { accounts, fork, providerRpcUrl, baseUrl, chainId } =
      await store.get()

    accounts && this.setAccounts(accounts)
    fork && this.setFork(fork)
    baseUrl && this.setBaseUrl(baseUrl)
    chainId && this.setChainId(chainId)

    this.setProviderRpcUrl(
      providerRpcUrl ?? process.env.PROVIDER_RPC_URL ?? null,
    )

    this.sync()
  }

  protected async _impersonateAllAccounts() {
    if (this.forkRpcUrl) await impersonateAll(this._accounts, this.forkRpcUrl)
  }

  /**
   * Sometimes neptune controller state & neptune server state get out of sync.
   * forks set here don't exist on the server, accounts are not impersonated,
   * etc. It's useful to expose a method of syncing / resetting state. Here we:
   *
   * - make sure the selected fork we has exists. if it does not, fork mainnet,
   *   and set it.
   * - make sure all accounts are impersonated
   */
  async sync() {
    const available = await getAvailableForks(this._baseUrl)
    const current = this.fork

    const noneAvailable = available.length === 0
    const shouldSelectFromAvailable =
      !noneAvailable && (!current || !available.some(f => f.id === current.id))

    if (noneAvailable && this._providerRpcUrl) {
      const fork = await forkMainnetLatest(this._baseUrl, this._providerRpcUrl)
      this.setFork(fork)
    }

    if (shouldSelectFromAvailable) {
      this.setFork(available[0])
    }

    await this._impersonateAllAccounts()
  }

  /**
   * Connections
   */

  isConnected(tabId: number) {
    return this._connectedTabs.has(tabId)
  }

  connect(tabId: number) {
    this._connectedTabs.add(tabId)
    msg.connection.emitChanged({ connected: true, tabId })
  }

  disconnect(tabId: number) {
    this._connectedTabs.delete(tabId)
    msg.connection.emitChanged({ connected: false, tabId })
  }

  /**
   * Chain ID
   */

  get chainId(): ChainId {
    return this._chainId
  }

  setChainId(chainId: ChainId) {
    this._chainId = chainId
    msg.chain.emitChanged(chainId)
  }

  /**
   * Accounts
   */

  get accounts(): Account[] {
    return this._accounts
  }

  setAccounts(accounts: Account[]) {
    if (JSON.stringify(this._accounts) === JSON.stringify(accounts)) return
    this._accounts = accounts
    msg.accounts.emitChanged(accounts)
  }

  /**
   * Active fork
   */

  get fork(): Fork | null {
    return this._fork
  }

  setFork(fork: Fork | null) {
    this._fork = fork
    msg.fork.emitChanged(fork)
    msg.forkRpcUrl.emitChanged(this.forkRpcUrl)
    this._impersonateAllAccounts()
  }

  get forkRpcUrl() {
    if (!this._fork) return null
    return url.fork(this._baseUrl, this._fork).toString()
  }

  /**
   * Base Neptune URL
   */

  get baseUrl() {
    return this._baseUrl
  }

  setBaseUrl(url: string) {
    this._baseUrl = new URL(url)
    msg.baseUrl.emitChanged(url)
    msg.forkRpcUrl.emitChanged(this.forkRpcUrl)
    this.sync()
  }

  /**
   * Default rpc provider url
   */

  get providerRpcUrl() {
    return this._providerRpcUrl
  }

  setProviderRpcUrl(url: string | null) {
    this._providerRpcUrl = url ? new URL(url) : null
    msg.providerRpcUrl.emitChanged(url)
  }

  /**
   * Rpc requests
   */

  async sendRpcRequest(data: RpcRequest | RpcRequest[]) {
    if (!this.forkRpcUrl) throw new Error('No active fork')

    const body = JSON.stringify(
      Array.isArray(data) ? data.map(addIdd) : addIdd(data),
    )

    return fetch(this.forkRpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': this._baseUrl.origin,
      },
      body,
    }).then(res => res.json())
  }
}

// small util to add null id to rpc requests if not present
// anvil treats empty id as invalid
const addIdd = (data: any) => ({
  ...data,
  id: data.id ?? null,
})
