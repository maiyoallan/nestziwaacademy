import { createHash, randomUUID } from 'node:crypto';

export const GATEWAY_DRIVERS = ['mock_sandbox','mpesa_stk','mpesa_paybill','airtel_money','bank_cheque','cash','in_kind'];

export function normalizeKenyanPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `254${digits.slice(1)}`;
  else if (digits.startsWith('7') || digits.startsWith('1')) digits = `254${digits}`;
  if (!/^254[17]\d{8}$/.test(digits)) throw Object.assign(new Error('Enter a Kenyan mobile number such as 0712 345 678 or +254 712 345 678.'), { status: 400 });
  return digits;
}

export function paymentRequestHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

class MockSandboxProvider {
  name = 'mock_sandbox';
  async initiate({ prompt }) {
    return {
      requestId: `SBX-${randomUUID().slice(0, 12).toUpperCase()}`,
      status: 'PENDING_PROMPT',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      message: `Sandbox payment prompt prepared for ${prompt.phone}. No money has been collected.`
    };
  }
  async disburse({ run }) {
    return {
      requestId: `SBX-PAYOUT-${randomUUID().slice(0, 12).toUpperCase()}`,
      status: 'PENDING_CONFIRMATION',
      message: `Sandbox disbursement prepared for KES ${Number(run.totalAmount).toFixed(2)}. No money has been sent.`
    };
  }
}

class ProviderStub {
  constructor(name, description) { this.name = name; this.description = description; }
  async initiate() {
    throw Object.assign(new Error(`${this.description} adapter is ready for credentials, but no live provider credentials are configured. Select the mock_sandbox driver to exercise this workflow.`), { status: 503, code: 'GATEWAY_NOT_CONFIGURED' });
  }
  async disburse() { return this.initiate(); }
  verifyCallback() { return false; }
}

const adapters = {
  mock_sandbox: new MockSandboxProvider(),
  mpesa_stk: new ProviderStub('mpesa_stk', 'M-Pesa STK Push'),
  mpesa_paybill: new ProviderStub('mpesa_paybill', 'M-Pesa Paybill'),
  airtel_money: new ProviderStub('airtel_money', 'Airtel Money'),
  bank_cheque: new ProviderStub('bank_cheque', 'Bank / cheque'),
  cash: new ProviderStub('cash', 'Cash'),
  in_kind: new ProviderStub('in_kind', 'In-kind delivery')
};

export function getPaymentPromptAdapter(channel) {
  const configured = String(process.env.PAYMENT_GATEWAY_DRIVER || 'mock_sandbox').toLowerCase();
  const channelDefault = channel === 'AIRTEL_MONEY' ? 'airtel_money' : channel === 'MPESA_PAYBILL' ? 'mpesa_stk' : null;
  const driver = process.env.PAYMENT_GATEWAY_DRIVER ? configured : 'mock_sandbox';
  const selected = adapters[driver];
  if (!selected) throw Object.assign(new Error(`Unknown payment gateway driver: ${driver}.`), { status: 500 });
  if (!['MPESA_PAYBILL','AIRTEL_MONEY'].includes(channel)) throw Object.assign(new Error('Prompt Me currently supports M-Pesa STK and Airtel Money. Cash, cheque, bank transfer, and in-kind contributions continue through Finance review.'), { status: 400 });
  if (driver !== 'mock_sandbox' && channelDefault && driver !== channelDefault) {
    throw Object.assign(new Error(`The selected ${channel.replaceAll('_',' ')} channel needs the ${channelDefault} driver.`), { status: 400 });
  }
  return selected;
}

export function adapterForDriver(driver) { return adapters[driver] || null; }

export function getDisbursementAdapter() {
  const driver = String(process.env.PAYMENT_GATEWAY_DRIVER || 'mock_sandbox').toLowerCase();
  const adapter = adapters[driver];
  if (!adapter) throw Object.assign(new Error(`Unknown payment gateway driver: ${driver}.`), { status: 500 });
  return adapter;
}

export async function initiatePrompt(adapter, prompt) {
  return adapter.initiate({ prompt });
}
