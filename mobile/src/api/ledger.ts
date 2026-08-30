/**
 * The wallet ledger and gift earnings.
 *
 * The ledger is append-only on the server: every row records what the balance
 * was before and after, so a disputed transaction can be traced rather than
 * argued about. Both values come through here for exactly that reason.
 */

import { api } from './client';

export type WalletKind = 'coin' | 'reward' | 'live_gift' | 'withdrawable';

export interface LedgerEntry {
  id: string;
  wallet: WalletKind;
  type: string;
  description: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  status: string;
  createdAt: string;
}

export interface GiftEarnings {
  days: number;
  /** Cleared and payable now. */
  availableAmount: number;
  /** Earned, still inside the clearing window — deliberately not added to available. */
  clearingAmount: number;
  currency: string;
  coinToPayoutRate: number;
  giftCoinsReceived: number;
  giftsReceived: number;
  giftCoinsSent: number;
  dailyCoins: { day: string; value: number }[];
  topGifters: {
    id: string;
    username: string;
    displayName: string;
    avatar: string | null;
    coins: number;
    gifts: number;
  }[];
}

export const ledger = {
  entries: (wallet?: WalletKind, limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (wallet) params.set('wallet', wallet);
    return api.get<LedgerEntry[]>(`/me/wallet/ledger?${params.toString()}`).then((r) => r.data);
  },

  giftEarnings: (days = 28) =>
    api.get<GiftEarnings>(`/me/gift-earnings?days=${days}`).then((r) => r.data),
};
