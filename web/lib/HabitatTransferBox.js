import {
  wrapListener,
  getToken,
  getConfig,
  ethers,
  getSigner,
  signPermit,
  setupTokenlist,
  encodeMultiCall
} from './utils.js';
import {
  getProviders,
  resolveName,
  getErc20Exit,
  sendTransaction
} from './rollup.js';
import HabitatCircle from '/lib/HabitatCircle.js';
import bananaFever from './banana.js';

const { DEFAULT_ROLLUP_OPERATOR_ADDRESS } = getConfig();

const L1_STR = '♢ Ethereum Mainnet';
const L2_STR = '🏕 Habitat Rollup';
const OPERATOR_STR = '⛽️ Rollup Operator';
const TYPE_DEPOSIT = 'Deposit';
const TYPE_WITHDRAW = 'Withdraw';
const TYPE_TRANSFER = 'Transfer';
const TYPE_EXIT = 'Exit';
const TYPE_TOP_UP = 'Top Up Gas Tank';

async function l2Transfer ({ to, token, amount }) {
  const value = ethers.utils.parseUnits(amount, token._decimals).toHexString();
  const args = {
    token: token.address,
    to,
    value
  };

  return sendTransaction('TransferToken', args);
}

async function l1Transfer ({ to, token, amount }) {
  const value = ethers.utils.parseUnits(amount, token._decimals).toHexString();
  const tx = await token.connect(await getSigner()).transfer(to, value);

  return tx.wait();
}


async function deposit ({ token, amount }) {
  const { MULTI_CALL_HELPER } = getConfig();
  const signer = await getSigner();
  const account = await signer.getAddress();
  const { habitat } = await getProviders();
  const value = ethers.utils.parseUnits(amount, token._decimals).toHexString();
  const multi = [];

  if (token.isETH) {
    multi.push(
      {
        // wrap ETH
        address: token.address,
        calldata: '0x',
        value: value
      }
    );
  } else {
    const allowance = await token.allowance(account, habitat.address);
    if (allowance.lt(value)) {
      let permit;
      try {
        permit = await signPermit(token, signer, MULTI_CALL_HELPER, value);
        multi.push(
          {
            address: token.address,
            calldata: permit.permitData,
            value: 0
          }
        );
      } catch (e) {
        console.log(e);
      }

      if (!permit) {
        const tx = await token.connect(signer).approve(habitat.address, value);
        await tx.wait();
      }
    }
  }

  let tx;
  if (multi.length) {
    if (!token.isETH) {
      multi.push(
        {
          address: token.address,
          calldata: token.interface.encodeFunctionData('transferFrom', [account, MULTI_CALL_HELPER, value]),
          value: 0
        }
      );
    }

    multi.push(
      {
        address: token.address,
        calldata: token.interface.encodeFunctionData('approve', [habitat.address, value]),
        value: 0
      },
      {
        address: habitat.address,
        calldata: habitat.interface.encodeFunctionData('deposit', [token.address, value, account]),
        value: 0
      }
    );

    console.log(multi);
    tx = {
      to: MULTI_CALL_HELPER,
      data: encodeMultiCall(multi),
      value: token.isETH ? value : '0x0'
    };
  } else {
    tx = {
      to: habitat.address,
      data: habitat.interface.encodeFunctionData('deposit', [token.address, value, account])
    };
  }

  console.log(tx);
  tx = await signer.sendTransaction(tx);

  return tx.wait();
}

async function exit ({ token, amount }) {
  const signer = await getSigner();
  const account = await signer.getAddress();
  const { habitat } = await getProviders();
  const tx = await habitat.connect(signer).withdraw(account, token.address, 0);

  return tx.wait();
}

async function withdraw ({ token, amount }) {
  const value = ethers.utils.parseUnits(amount, token._decimals).toHexString();
  const args = {
    token: token.address,
    to: ethers.constants.AddressZero,
    value
  };
  await sendTransaction('TransferToken', args);
}

async function topUpGas ({ token, amount }) {
  const value = ethers.utils.parseUnits(amount, token._decimals).toHexString();
  const args = {
    operator: DEFAULT_ROLLUP_OPERATOR_ADDRESS,
    token: token.address,
    amount: value
  };
  await sendTransaction('TributeForOperator', args);
}

const TEMPLATE =
`
<style>
habitat-transfer-box input {
  max-width: auto;
  min-width: auto;
  width: 100%;
  border-radius: 2em;
  background-color: var(--color-bg);
}
habitat-transfer-box input[list] {
  cursor: pointer;
}

#mid {
  background-color: var(--color-accent-grey);
  border-radius: 2em;
  padding: 1em;
}

#ab {
  display: grid;
  gap: 1em;
  grid-template-columns: 1fr 1fr;
  place-items: end;
}

#sign {
  margin-top: -1.5em;
  background-color: var(--color-bg-invert);
  color: var(--color-bg);
}
</style>
<datalist id='networklist'>
  <option value='${L1_STR}'>
  <option value='${L2_STR}'>
</datalist>
<datalist id='actionlist'>
  <option value='${TYPE_DEPOSIT}'>
  <option value='${TYPE_WITHDRAW}'>
  <option value='${TYPE_TRANSFER}'>
  <option value='${TYPE_EXIT}'>
  <option value='${TYPE_TOP_UP}'>
</datalist>
<div class='flex col'>
  <label>
    <input id='action' autocomplete='off' list='actionlist' placeholder='Choose Action...'>
  </label>

  <div id='mid'>
    <label>
      <input id='from' list='networklist' placeholder='Network'>
    </label>

    <div id='ab'>
      <label>
        <br>
        <input id='token' autocomplete='off' list='tokenlist' placeholder='Token'>
      </label>
      <label>
        <div style='margin-left:.5em;'>
          <span>Current Balance: <a href='' id='available'></a></span>
        </div>
        <input id='amount' type='number' placeholder='Amount'>
      </label>
    </div>

    <object type='image/svg+xml' style='height:2em;' data='/lib/assets/arrow-group.svg'></object>

    <label>
      <input id='to' autocomplete='off' list='networklist' placeholder='To'>
    </label>
  </div>

  <button id='sign' class='bigger'>Good Feeling</button>
  <space></space>
  <p id='feedback' class='big'> </p>
</div>
`;

export default class HabitatTransferBox extends HTMLElement {
  static get observedAttributes() {
    return [];
  }

  constructor() {
    super();
  }

  connectedCallback () {
    if (!this.children.length) {
      this.innerHTML = TEMPLATE;
      setupTokenlist();

      this._from = this.querySelector('#from');
      this._to = this.querySelector('#to');
      this._signButton = this.querySelector('#sign');
      this._action = this.querySelector('#action');
      this._token = this.querySelector('#token');
      this._maxAmount = this.querySelector('#available');

      wrapListener(this._action, this.onSelect.bind(this), 'change');
      wrapListener(this._token, this.onSelect.bind(this), 'change');
      wrapListener(this._from, this.onSelect.bind(this), 'change');
      wrapListener(this._signButton, this.onSign.bind(this));
      wrapListener(this._maxAmount, () => {
        this.querySelector('#amount').value = this._maxAmount.textContent;
      });

      for (const element of this.querySelectorAll('input[list]')) {
        element.addEventListener('input', (evt) => {
          if (!evt.target.list) {
            return;
          }
          for (const option of evt.target.list.options) {
            if (option.value === evt.target.value) {
              evt.target.blur();
              break;
            }
          }
        }, false);
        element.addEventListener('pointerdown', (evt) => {
          if (evt.target.readOnly || !evt.target.list) {
            return;
          }
          evt.target.value = '';
        }, false);
      }
    }
  }

  disconnectedCallback () {
  }

  adoptedCallback () {
  }

  attributeChangedCallback (name, oldValue, newValue) {
  }

  async onSelect (evt) {
    const type = this._action.value;

    if (type) {
      this._signButton.textContent = type;
    }

    if (type === TYPE_DEPOSIT) {
      this._from.value = L1_STR;
      this._from.readOnly = true;

      this._to.value = L2_STR;
      this._to.readOnly = true;
      this._to.setAttribute('list', 'networklist');
    }
    if (type === TYPE_WITHDRAW || type === TYPE_EXIT) {
      this._from.value = L2_STR;
      this._from.readOnly = true;

      this._to.value = L1_STR;
      this._to.readOnly = true;
      this._to.setAttribute('list', 'networklist');

      if (type === TYPE_EXIT && this._token.value) {
        try {
          const token = await getToken(this._token.value);
          const signer = await getSigner();
          const account = signer.getAddress();
          const available = await getErc20Exit(token.address, account);
          this._maxAmount.textContent = ethers.utils.formatUnits(available, token._decimals).toString();
        } catch (e) {
          console.error(e);
        }
        return;
      }
    }

    if (type === TYPE_TOP_UP) {
      this._from.value = L2_STR;
      this._from.readOnly = true;

      this._to.value = OPERATOR_STR;
      this._to.readOnly = true;
    }

    if (type === TYPE_TRANSFER) {
      this._from.readOnly = false;
      this._to.readOnly = false;
      this._to.value = '';
      this._to.removeAttribute('list');
    }

    let available = '0';
    if (this._token.value && type !== TYPE_EXIT) {
      const signer = await getSigner();
      const account = signer.getAddress();
      const token = await getToken(this._token.value);
      let availableAmount = BigInt(0);
      if (this._from.value === L1_STR) {
        availableAmount = BigInt(await token.balanceOf(account));
      } else {
        const { habitat } = await getProviders();
        availableAmount = BigInt(await habitat.callStatic.getBalance(token.address, account));
      }
      available = ethers.utils.formatUnits(availableAmount, token._decimals);
    }
    this._maxAmount.textContent = available;
  }

  async onSign (evt) {
    const type = this._action.value;

    if (!type) {
      bananaFever();
      return;
    }

    const token = await getToken(this._token.value);
    const amount = this.querySelector('#amount').value;
    const feedback = this.querySelector('#feedback');

    feedback.textContent = 'Pending...';

    try {
      if (type === TYPE_DEPOSIT) {
        await deposit({ token, amount });
      }

      if (type === TYPE_WITHDRAW) {
        await withdraw({ token, amount });
      }

      if (type === TYPE_TRANSFER) {
        const network = this._from.value;
        if (network !== L1_STR && network !== L2_STR) {
          throw new Error('unknown network');
        }

        const to = await resolveName(this._to.value);

        if (this._from.value === L1_STR) {
          await l1Transfer({ to, token, amount });
        } else {
          await l2Transfer({ to, token, amount });
        }
      }

      if (type === TYPE_EXIT) {
        await exit({ token, amount });
      }

      if (type === TYPE_TOP_UP) {
        await topUpGas({ token, amount });
      }

      feedback.textContent = '🙌 success';
    } catch (e) {
      feedback.textContent = ' ';
      throw e;
    }
  }

  doExit (token, amount) {
    this._action.value = TYPE_EXIT;
    this._token.value = token;
    this.onSelect();
    this.scrollIntoView();
  }
}

customElements.define('habitat-transfer-box', HabitatTransferBox);
