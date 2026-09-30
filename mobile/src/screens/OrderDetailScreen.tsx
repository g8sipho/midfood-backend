import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchOrder, fetchTracking, requestPayfastCheckout } from '../api/client';
import OrderStatusBadge from '../components/OrderStatusBadge';
import Button from '../components/Button';
import { colors, radius, spacing } from '../theme/colors';
import type { Order, Tracking } from '../types';
import type { OrdersStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<OrdersStackParamList, 'OrderDetail'>;

const STEPS: { key: Order['status']; label: string }[] = [
  { key: 'placed', label: 'Order placed' },
  { key: 'confirmed', label: 'Restaurant accepted' },
  { key: 'preparing', label: 'Preparing your food' },
  { key: 'out_for_delivery', label: 'Out for delivery' },
  { key: 'delivered', label: 'Delivered' },
];

// How often to refresh live tracking while an order is still on its way.
const TRACK_INTERVAL_MS = 8000;

// While payment is still "pending", PayFast's confirmation (the ITN) usually
// arrives within a couple of seconds of the customer finishing on their
// site -- poll a few times so the screen catches up on its own without the
// customer needing to do anything.
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 15;

function minutesAgo(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) : null;
}

export default function OrderDetailScreen({ route }: Props) {
  const { orderId } = route.params;
  const [order, setOrder] = useState<Order | null>(null);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const fresh = await fetchOrder(orderId);
      setOrder(fresh);
      return fresh;
    } catch (err: any) {
      setError(err.message || 'Could not load this order.');
      return null;
    }
  }, [orderId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Poll while payment is still pending, so a successful payment shows up
  // automatically instead of requiring the customer to back out and back in.
  useEffect(() => {
    if (!order || order.paymentStatus !== 'pending') return;
    if (pollCount.current >= MAX_POLLS) return;

    const timer = setTimeout(async () => {
      pollCount.current += 1;
      await load();
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [order, load]);

  // Live tracking: statuses are set for real by the restaurant portal and the
  // driver app, so this just keeps polling until the order is finished.
  useEffect(() => {
    if (!order || order.paymentStatus !== 'paid') return;
    if (order.status === 'delivered' || order.status === 'rejected') return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const t = await fetchTracking(orderId);
        if (cancelled) return;
        setTracking(t);
        // Keep the order card's own status badge in step with tracking.
        setOrder((prev) => (prev && prev.status !== t.status ? { ...prev, status: t.status } : prev));
        if (t.status !== 'delivered' && t.status !== 'rejected') {
          timer = setTimeout(tick, TRACK_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) timer = setTimeout(tick, TRACK_INTERVAL_MS);
      }
    };
    tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orderId, order?.paymentStatus, order?.status === 'delivered', order?.status === 'rejected']);

  async function handleRetryPayment() {
    setRetrying(true);
    setError(null);
    try {
      const paymentUrl = await requestPayfastCheckout(orderId);
      await WebBrowser.openBrowserAsync(paymentUrl);
      pollCount.current = 0;
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not start payment. Please try again.');
    } finally {
      setRetrying(false);
    }
  }

  if (loading) {
    return <ActivityIndicator style={styles.loading} color={colors.accentPrimary} />;
  }

  if (error || !order) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error || 'Order not found.'}</Text>
      </View>
    );
  }

  const status = tracking?.status ?? order.status;
  const currentIndex = STEPS.findIndex((s) => s.key === status);
  const isPaid = order.paymentStatus === 'paid';
  const driverSeen = minutesAgo(tracking?.driverSeenAt ?? null);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.restaurantName}>{order.restaurantName}</Text>
        <OrderStatusBadge status={status} />
      </View>
      <Text style={styles.address}>Delivering to: {order.deliveryAddress}</Text>

      {order.paymentStatus === 'pending' && (
        <View style={[styles.paymentCard, styles.paymentPending]}>
          <ActivityIndicator color={colors.accentWarning} style={{ marginBottom: spacing.sm }} />
          <Text style={styles.paymentTitle}>Waiting for payment confirmation</Text>
          <Text style={styles.paymentBody}>
            If you finished paying on PayFast, this updates automatically within a few seconds. If
            you closed the payment page without paying, tap below to try again.
          </Text>
          <Button title="Retry payment" onPress={handleRetryPayment} loading={retrying} />
        </View>
      )}

      {order.paymentStatus === 'failed' && (
        <View style={[styles.paymentCard, styles.paymentFailed]}>
          <Text style={styles.paymentTitle}>Payment didn't go through</Text>
          <Text style={styles.paymentBody}>Your order is saved — try paying again to confirm it.</Text>
          <Button title="Retry payment" onPress={handleRetryPayment} loading={retrying} />
        </View>
      )}

      {status === 'rejected' && (
        <View style={[styles.paymentCard, styles.paymentFailed]}>
          <Text style={styles.paymentTitle}>The restaurant couldn't take this order</Text>
          <Text style={styles.paymentBody}>
            {tracking?.rejectedReason || order.rejectedReason || 'No reason was given.'} You'll be
            refunded — contact MidFood on 013 000 0000 if you don't see it within 3 working days.
          </Text>
        </View>
      )}

      {isPaid && status !== 'rejected' && (
        <>
          <View style={styles.timeline}>
            {STEPS.map((step, i) => (
              <View key={step.key} style={styles.timelineRow}>
                <View style={[styles.dot, i <= currentIndex && styles.dotActive]} />
                <Text style={[styles.timelineLabel, i <= currentIndex && styles.timelineLabelActive]}>
                  {step.label}
                </Text>
              </View>
            ))}
          </View>

          {tracking?.driverName && (
            <View style={styles.driverCard}>
              <Text style={styles.driverLabel}>
                {status === 'out_for_delivery' ? 'Your driver is on the way' : 'Your driver'}
              </Text>
              <Text style={styles.driverName}>{tracking.driverName}</Text>
              {tracking.driverPhone && (
                <TouchableOpacity onPress={() => Linking.openURL(`tel:${tracking.driverPhone}`)}>
                  <Text style={styles.driverPhone}>Call {tracking.driverPhone}</Text>
                </TouchableOpacity>
              )}
              {tracking.driverLat != null && tracking.driverLng != null && (
                <>
                  <TouchableOpacity
                    onPress={() =>
                      Linking.openURL(
                        `https://www.google.com/maps/search/?api=1&query=${tracking.driverLat},${tracking.driverLng}`
                      )
                    }
                  >
                    <Text style={styles.driverMapLink}>See where the driver is on a map</Text>
                  </TouchableOpacity>
                  <Text style={styles.driverSeen}>
                    {driverSeen === 0
                      ? 'Location updated just now'
                      : driverSeen != null
                        ? `Location updated ${driverSeen} min ago`
                        : ''}
                  </Text>
                </>
              )}
            </View>
          )}
        </>
      )}

      <View style={styles.card}>
        {order.items.map((item) => (
          <View key={item.menuItemId} style={styles.line}>
            <Text style={styles.lineText}>
              {item.quantity}× {item.name}
            </Text>
            <Text style={styles.lineText}>R{item.price * item.quantity}</Text>
          </View>
        ))}
        <View style={styles.divider} />
        <View style={styles.line}>
          <Text style={styles.lineText}>Delivery fee</Text>
          <Text style={styles.lineText}>R{order.deliveryFee}</Text>
        </View>
        <View style={styles.line}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>R{order.total}</Text>
        </View>
      </View>

      {order.notes ? <Text style={styles.orderNote}>Your note: {order.notes}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgApp,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  loading: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: colors.accentError,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  restaurantName: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  address: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  paymentCard: {
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    gap: spacing.sm,
  },
  paymentPending: {
    backgroundColor: `${colors.accentWarning}14`,
    borderColor: colors.accentWarning,
  },
  paymentFailed: {
    backgroundColor: `${colors.accentError}14`,
    borderColor: colors.accentError,
  },
  paymentTitle: {
    fontWeight: '800',
    color: colors.textPrimary,
    fontSize: 15,
  },
  paymentBody: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  timeline: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.accentPrimary,
  },
  timelineLabel: {
    color: colors.textTertiary,
    fontSize: 13,
  },
  timelineLabelActive: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 6,
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  lineText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 6,
  },
  totalLabel: {
    fontWeight: '800',
    color: colors.textPrimary,
  },
  totalValue: {
    fontWeight: '800',
    color: colors.accentPrimary,
  },
  driverCard: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.accentPrimary,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  driverLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accentPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  driverName: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  driverPhone: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accentBlue,
    marginTop: spacing.xs,
  },
  driverMapLink: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accentBlue,
    marginTop: spacing.xs,
  },
  driverSeen: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
  orderNote: {
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
});
