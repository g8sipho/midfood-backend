import React from 'react';
import { Pill } from './ui';
import type { OrderStatus, PaymentStatus } from '../types';

const LABELS: Record<OrderStatus, string> = {
  placed: 'Waiting for kitchen',
  confirmed: 'Accepted',
  preparing: 'Cooking',
  out_for_delivery: 'On the way',
  delivered: 'Delivered',
  rejected: 'Declined',
};

const TONES: Record<OrderStatus, 'mango' | 'mint' | 'ember' | 'berry' | 'neutral'> = {
  placed: 'mango',
  confirmed: 'mint',
  preparing: 'mint',
  out_for_delivery: 'ember',
  delivered: 'neutral',
  rejected: 'berry',
};

export default function OrderStatusBadge({ status, paymentStatus }: { status: OrderStatus; paymentStatus?: PaymentStatus }) {
  if (paymentStatus === 'pending') return <Pill label="Payment pending" tone="mango" icon="credit-card-clock-outline" />;
  if (paymentStatus === 'failed') return <Pill label="Not paid" tone="berry" icon="credit-card-off-outline" />;
  return <Pill label={LABELS[status]} tone={TONES[status]} />;
}
