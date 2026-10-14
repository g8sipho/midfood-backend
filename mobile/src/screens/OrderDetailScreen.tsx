import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchOrder, fetchTracking, rateOrder, requestPayfastCheckout } from '../api/client';
import OrderStatusBadge from '../components/OrderStatusBadge';
import Button from '../components/Button';
import Txt from '../components/Txt';
import { Card, Divider, Icon, Skeleton } from '../components/ui';
import { colors, radius, rands, spacing } from '../theme';
import type { Order, Tracking } from '../types';
import type { OrdersStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<OrdersStackParamList, 'OrderDetail'>;

const STEPS: { key: Order['status']; label: string; detail: string; icon: any }[] = [
  { key: 'placed', label: 'Order placed', detail: 'Waiting for the kitchen to accept', icon: 'receipt-text-check-outline' },
  { key: 'confirmed', label: 'Kitchen accepted', detail: 'They have it and are starting', icon: 'chef-hat' },
  { key: 'preparing', label: 'Cooking', detail: 'Your food is being made', icon: 'pot-steam-outline' },
  { key: 'out_for_delivery', label: 'On the way', detail: 'Your driver has it', icon: 'moped' },
  { key: 'delivered', label: 'Delivered', detail: 'Enjoy!', icon: 'check-circle-outline' },
];

const TRACK_INTERVAL_MS = 8000;
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 15;

function minutesAgo(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) : null;
}

export default function OrderDetailScreen({ route, navigation }: Props) {
  const { orderId } = route.params;
  const insets = useSafeAreaInsets();
  const [order, setOrder] = useState<Order | null>(null);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stars, setStars] = useState(0);
  const [rated, setRated] = useState(false);
  const pollCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const fresh = await fetchOrder(orderId);
      setOrder(fresh);
      if (fresh.rating) {
        setStars(fresh.rating);
        setRated(true);
      }
      return fresh;
    } catch (err: any) {
      setError(err.message || "Couldn't load this order.");
      return null;
    }
  }, [orderId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // While payment is pending, PayFast's confirmation usually lands within
  // seconds; poll a few times so the screen catches up on its own.
  useEffect(() => {
    if (!order || order.paymentStatus !== 'pending') return;
    if (pollCount.current >= MAX_POLLS) return;
    const timer = setTimeout(async () => {
      pollCount.current += 1;
      await load();
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [order, load]);

  // Live tracking until the order is finished.
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
        setOrder((prev) => (prev && prev.status !== t.status ? { ...prev, status: t.status } : prev));
        if (t.status !== 'delivered' && t.status !== 'rejected') timer = setTimeout(tick, TRACK_INTERVAL_MS);
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
      setError(err.message || "Couldn't start the payment. Try again.");
    } finally {
      setRetrying(false);
    }
  }

  async function rate(n: number) {
    setStars(n);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await rateOrder(orderId, n);
      setRated(true);
    } catch (err: any) {
      setError(err.message || "Couldn't save your rating.");
    }
  }

  const openChat = () => {
    if (!order) return;
    navigation.getParent()?.navigate('ChatsTab', {
      screen: 'ChatThread',
      params: { orderId: order.id, restaurantId: order.restaurantId, title: order.restaurantName },
    });
  };

  if (loading) {
    return (
      <View style={[styles.container, { padding: spacing.lg, gap: spacing.md }]}>
        <Skeleton height={40} width="70%" />
        <Skeleton height={260} round={radius.lg} />
        <Skeleton height={160} round={radius.lg} />
      </View>
    );
  }

  if (error && !order) {
    return (
      <View style={styles.centered}>
        <Txt variant="body" color={colors.berry}>
          {error}
        </Txt>
      </View>
    );
  }
  if (!order) return null;

  const status = tracking?.status ?? order.status;
  const currentIndex = STEPS.findIndex((s) => s.key === status);
  const isPaid = order.paymentStatus === 'paid';
  const driverSeen = minutesAgo(tracking?.driverSeenAt ?? null);
  const finished = status === 'delivered' || status === 'rejected';

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Txt variant="title">{order.restaurantName}</Txt>
          <Txt variant="small" numberOfLines={2}>
            To {order.deliveryAddress}
          </Txt>
        </View>
        <OrderStatusBadge status={status} paymentStatus={order.paymentStatus} />
      </View>

      {order.paymentStatus === 'pending' && (
        <Card style={[styles.notice, { backgroundColor: colors.mangoSoft }]}>
          <Txt variant="subheading">Waiting for your payment</Txt>
          <Txt variant="small">
            If you finished on PayFast, this updates by itself in a few seconds. If you closed the payment page, pay now to send the order to the kitchen.
          </Txt>
          <Button title="Pay now" onPress={handleRetryPayment} loading={retrying} trailing={rands(order.total)} />
        </Card>
      )}

      {order.paymentStatus === 'failed' && (
        <Card style={[styles.notice, { backgroundColor: colors.berrySoft }]}>
          <Txt variant="subheading">The payment didn't go through</Txt>
          <Txt variant="small">Your order is saved. Pay again to send it to the kitchen.</Txt>
          <Button title="Try the payment again" onPress={handleRetryPayment} loading={retrying} />
        </Card>
      )}

      {status === 'rejected' && (
        <Card style={[styles.notice, { backgroundColor: colors.berrySoft }]}>
          <Txt variant="subheading">The kitchen couldn't take this order</Txt>
          <Txt variant="small">
            {tracking?.rejectedReason || order.rejectedReason || 'No reason was given.'} You'll be refunded to the card you paid with within 3 working days.
          </Txt>
          <Button title="Ask MidFood about the refund" variant="dark" icon="chat-outline" onPress={() => navigation.getParent()?.navigate('ChatsTab', { screen: 'ChatThread', params: { orderId: order.id, title: 'MidFood support' } })} />
        </Card>
      )}

      {isPaid && status !== 'rejected' && (
        <Card style={{ padding: spacing.lg }}>
          {STEPS.map((step, i) => {
            const done = i < currentIndex;
            const now = i === currentIndex;
            return (
              <View key={step.key} style={styles.step}>
                <View style={styles.stepRail}>
                  <View style={[styles.stepDot, (done || now) && styles.stepDotOn, now && styles.stepDotNow]}>
                    <Icon name={done ? 'check' : step.icon} size={now ? 18 : 14} color={done || now ? colors.onDark : colors.inkFaint} />
                  </View>
                  {i < STEPS.length - 1 ? <View style={[styles.stepLine, done && styles.stepLineOn]} /> : null}
                </View>
                <View style={styles.stepText}>
                  <Txt variant={now ? 'subheading' : 'bodyMedium'} color={done || now ? colors.ink : colors.inkFaint}>
                    {step.label}
                  </Txt>
                  {now && !finished ? <Txt variant="small">{step.detail}</Txt> : null}
                </View>
              </View>
            );
          })}
        </Card>
      )}

      {isPaid && tracking?.driverName && status !== 'delivered' && (
        <Card style={styles.driverCard}>
          <View style={styles.driverHead}>
            <View style={styles.driverAvatar}>
              <Icon name="moped" size={24} color={colors.onDark} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="small" color={colors.ember}>
                {status === 'out_for_delivery' ? 'Your driver is on the way' : 'Your driver'}
              </Txt>
              <Txt variant="heading">{tracking.driverName}</Txt>
              {tracking.driverLat != null ? (
                <Txt variant="small">
                  {driverSeen === 0 ? 'Location updated just now' : driverSeen != null ? `Location updated ${driverSeen} min ago` : ''}
                </Txt>
              ) : null}
            </View>
          </View>
          <View style={styles.driverActions}>
            {tracking.driverPhone ? (
              <Button title="Call" variant="dark" size="sm" icon="phone" onPress={() => Linking.openURL(`tel:${tracking.driverPhone}`)} style={{ flex: 1 }} />
            ) : null}
            {tracking.driverLat != null && tracking.driverLng != null ? (
              <Button
                title="See on map"
                variant="secondary"
                size="sm"
                icon="map-marker-radius-outline"
                onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${tracking.driverLat},${tracking.driverLng}`)}
                style={{ flex: 1 }}
              />
            ) : null}
          </View>
        </Card>
      )}

      {isPaid && status === 'delivered' && (
        <Card style={styles.rateCard}>
          <Txt variant="heading" center>
            {rated ? 'Thanks for rating!' : 'How was it?'}
          </Txt>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => (rated ? null : rate(n))} hitSlop={6}>
                <Icon name={n <= stars ? 'star' : 'star-outline'} size={38} color={n <= stars ? colors.mango : colors.sandDeep} />
              </Pressable>
            ))}
          </View>
          <Txt variant="small" center>
            {rated ? 'Your rating helps the next hungry person choose.' : 'Tap a star. Only you and MidFood see who rated.'}
          </Txt>
        </Card>
      )}

      <Card onPress={openChat} style={styles.chatRow}>
        <View style={styles.chatIcon}>
          <Icon name="chat-processing-outline" size={20} color={colors.ember} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="subheading">Chat about this order</Txt>
          <Txt variant="small">Ask the kitchen anything. "Where is my order?" is answered instantly.</Txt>
        </View>
        <Icon name="chevron-right" size={20} color={colors.inkFaint} />
      </Card>

      <Card>
        {order.items.map((item) => (
          <View key={item.menuItemId} style={styles.line}>
            <Txt variant="body" style={{ flex: 1 }}>
              {item.quantity} × {item.name}
            </Txt>
            <Txt variant="bodyMedium">{rands(item.price * item.quantity)}</Txt>
          </View>
        ))}
        <Divider />
        <View style={styles.line}>
          <Txt variant="body" color={colors.inkSoft}>
            Delivery
          </Txt>
          <Txt variant="bodyMedium">{order.deliveryFee === 0 ? 'Free' : rands(order.deliveryFee)}</Txt>
        </View>
        <View style={styles.line}>
          <Txt variant="subheading">Total</Txt>
          <Txt variant="price" color={colors.emberDeep}>
            {rands(order.total)}
          </Txt>
        </View>
        {order.notes ? (
          <Txt variant="small" style={{ marginTop: spacing.sm, fontStyle: 'italic' }}>
            Your note: {order.notes}
          </Txt>
        ) : null}
        {order.paymentReference ? (
          <Txt variant="small" style={{ marginTop: 4 }}>
            Payment reference {order.paymentReference}
          </Txt>
        ) : null}
      </Card>

      {error ? (
        <Txt variant="small" color={colors.berry} center>
          {error}
        </Txt>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  notice: {
    gap: spacing.sm,
  },
  step: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stepRail: {
    alignItems: 'center',
    width: 32,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotOn: {
    backgroundColor: colors.plum,
  },
  stepDotNow: {
    backgroundColor: colors.ember,
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  stepLine: {
    width: 3,
    flex: 1,
    minHeight: 22,
    backgroundColor: colors.sand,
    marginVertical: 3,
    borderRadius: 2,
  },
  stepLineOn: {
    backgroundColor: colors.plum,
  },
  stepText: {
    flex: 1,
    paddingBottom: spacing.md,
    paddingTop: 4,
  },
  driverCard: {
    borderWidth: 1.5,
    borderColor: colors.ember,
    gap: spacing.md,
  },
  driverHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  driverAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.ember,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rateCard: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  stars: {
    flexDirection: 'row',
    gap: 6,
    marginVertical: spacing.xs,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chatIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.emberSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 4,
  },
});
