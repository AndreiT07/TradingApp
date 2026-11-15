// Crypto news uses RSS only; equity research does not apply to these assets.
export const cryptoAssets = [
  { ticker: 'CRYPTO', name: 'Crypto', symbol: '◎', query: '(cryptocurrency OR bitcoin OR ethereum OR blockchain)', keywords: ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'btc', 'ether', 'solana', 'stablecoin'] },
  { ticker: 'BTC', name: 'Bitcoin', symbol: '₿', query: 'Bitcoin cryptocurrency', keywords: ['bitcoin', 'btc'] },
  { ticker: 'ETH', name: 'Ethereum', symbol: 'Ξ', query: 'Ethereum cryptocurrency', keywords: ['ethereum', 'ether', 'eth'] },
  { ticker: 'SOL', name: 'Solana', symbol: 'S', query: 'Solana cryptocurrency', keywords: ['solana'] },
].map(asset => ({ ...asset, type: 'crypto', sector: 'Crypto' }));
