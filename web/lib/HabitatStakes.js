import {
  walletIsConnected,
  getSigner,
} from './utils.js';
import {
  getProviders,
  doQuery,
  onChainUpdate
} from './rollup.js';

import './HabitatStake.js';

const TEMPLATE =
`
<div>
  <space></space>
  <div class='flex row evenly'>
    <p class='bold' id='info'></p>
  </div>
  <div id='stakes' class='flex evenly center'></div>
  <space></space>
</div>`;

export default class HabitatStakes extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback () {
    if (!this.children.length) {
      this.innerHTML = TEMPLATE;
      this._container = document.querySelector('#stakes');

      this.update();
    }
  }

  async update () {
    if (!this.isConnected) {
      return;
    }
    onChainUpdate(this.update.bind(this));

    if (!walletIsConnected) {
      return;
    }

    const signer = await getSigner();
    const account = await signer.getAddress();
    const { habitat } = await getProviders();
    const tmp = {};
    for (const log of await doQuery('VotedOnProposal', account)) {
      const { proposalId, signalStrength, shares } = log.args;
      tmp[proposalId] = { shares, signalStrength };
    }

    for (const proposalId in tmp) {
      const { shares, signalStrength } = tmp[proposalId];
      if (shares.eq(0)) {
        // ignore
        continue;
      }

      if (this._container.querySelector(`[x-proposal="${proposalId}"]`)) {
        continue;
      }

      const ele = document.createElement('habitat-stake');
      ele.setAttribute('x-proposal', proposalId);
      ele.setAttribute('x-shares', shares.toString());
      ele.setAttribute('x-signal', signalStrength.toString());
      this._container.appendChild(ele);
    }

    this.querySelector('#info').textContent =
      this._container.children.length === 0 ? 'You staked on no proposals yet.' : '';
  }
}

customElements.define('habitat-stakes', HabitatStakes);
