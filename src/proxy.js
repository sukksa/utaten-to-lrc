import config from './config.js';

/**
 * 如需通过代理访问 utaten（例如在需要科学上网的网络环境），
 * 设置 HTTPS_PROXY=http://127.0.0.1:7890 后再启动即可。
 */
export async function setupProxy() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxy || config.base.includes('127.0.0.1') || config.base.includes('localhost')) return null;

  const { ProxyAgent, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(new ProxyAgent(proxy));
  return proxy;
}
