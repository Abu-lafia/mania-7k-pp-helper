export class OsuAuth {
  constructor(credentials, fetcher = fetch) {
    this.credentials = credentials;
    this.fetcher = fetcher;
    this.expires = 0;
  }
  async token() {
    if (this.expires > Date.now()) return this.accessToken;
    if (!this.pending) this.pending = this.refresh().finally(() => { this.pending = null; });
    return this.pending;
  }
  async refresh() {
    const response = await this.fetcher('https://osu.ppy.sh/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: this.credentials.clientId, client_secret: this.credentials.clientSecret,
        grant_type: 'client_credentials', scope: 'public' }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(`osu! OAuth returned HTTP ${response.status}.`);
    const data = await response.json();
    if (!data.access_token || !Number.isFinite(data.expires_in)) throw new Error('Invalid osu! OAuth response.');
    this.accessToken = data.access_token;
    this.expires = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
    return this.accessToken;
  }
}
