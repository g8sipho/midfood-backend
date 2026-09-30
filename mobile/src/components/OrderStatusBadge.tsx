import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme/colors';
import type { OrderStatus } from '../types';

const LABELS: Record<OrderStatus, string> = {
  placed: 'Placed',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  rejected: 'Declined',
};

const COLORS: Record<OrderStatus, string> = {
  placed: colors.accentWarning,
  confirmed: colors.accentBlue,
  preparing: colors.accentBlue,
  out_for_delivery: colors.accentPrimary,
  delivered: colors.accentSuccess,
  rejected: colors.accentError,
};

export default function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const color = COLORS[status];
  return (
    <View style={[styles.badge, { backgroundColor: `${color}22`, borderColor: color }]}>
      <Text style={[styles.text, { color }]}>{LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
  },
});
