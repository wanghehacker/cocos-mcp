module.exports = (Editor as any).Panel.define({
  listeners: {
    show() {},
    hide() {},
  },
  template: `
    <div id="app">
      <h2>MCP Bridge</h2>
      <div class="row"><span class="label">Status:</span><span id="status">--</span></div>
      <div class="row"><span class="label">Port:</span><span id="port">--</span></div>
      <div class="row"><span class="label">Clients:</span><span id="clients">--</span></div>
      <div class="actions">
        <ui-button id="btn-start">Start</ui-button>
        <ui-button id="btn-stop">Stop</ui-button>
        <ui-button id="btn-refresh">Refresh</ui-button>
      </div>
    </div>
  `,
  style: `
    #app { padding: 10px; font-family: sans-serif; }
    h2 { margin: 0 0 10px 0; }
    .row { margin: 4px 0; }
    .label { display: inline-block; width: 80px; color: #999; }
    .actions { margin-top: 12px; display: flex; gap: 8px; }
  `,
  $: {
    status: '#status',
    port: '#port',
    clients: '#clients',
    btnStart: '#btn-start',
    btnStop: '#btn-stop',
    btnRefresh: '#btn-refresh',
  },
  methods: {
    async refresh() {
      const info = await (Editor as any).Message.request('cocos-mcp', 'cocos-mcp:query-status');
      if (info) {
        (this as any).$.status.textContent = info.running ? 'Running' : 'Stopped';
        (this as any).$.status.style.color = info.running ? '#4caf50' : '#f44336';
        (this as any).$.port.textContent = String(info.port);
        (this as any).$.clients.textContent = String(info.clients);
      }
    },
  },
  ready() {
    const self = this as any;
    self.$.btnStart.addEventListener('confirm', () => {
      (Editor as any).Message.send('cocos-mcp', 'cocos-mcp:start');
      setTimeout(() => self.refresh(), 500);
    });
    self.$.btnStop.addEventListener('confirm', () => {
      (Editor as any).Message.send('cocos-mcp', 'cocos-mcp:stop');
      setTimeout(() => self.refresh(), 500);
    });
    self.$.btnRefresh.addEventListener('confirm', () => {
      self.refresh();
    });
    self.refresh();
  },
  beforeClose() {},
  close() {},
});
