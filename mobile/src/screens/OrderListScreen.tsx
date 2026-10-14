import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { fetchOrders } from '../api/client';
import OrderStatusBadge from '../components/OrderStatusBadge';
import Txt from '../components/Txt';
import Button from '../components/Button';
import { Card, EmptyState, Icon, Skeleton } from '../components/ui';
import { colors, rands, spacing } from '../theme';
import type { Order } from '../types';
import type { OrdersStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<OrdersStackParamList, 'OrderList'>;

const LIVE = new Set(['placed', 'confirmed', 'preparing', 'out_for_delivery']);

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

export default function OrderListScreen({ navigation }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOrders(await fetchOrders());
    } catch (err: any) {
      setError(err.message || "Couldn't load your orders.");
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (loading) {
    return (
      <View style={[styles.container, { padding: spacing.lg, gap: spacing.md }]}>
        <Skeleton height={110} />
        <Skeleton height={110} />
        <Skeleton height={110} />
      </View>
    );
  }

  const live = orders.filter((o) => o.paymentStatus === 'paid' && LIVE.has(o.status));
  const rest = orders.filter((o) => !live.includes(o));

  return (
    <View style={styles.container}>
      <FlatList
        data={[...live, ...rest]}
        keyExtractor={(o) => o.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ember} />}
        ListHeaderComponent={
          error ? (
            <Txt variant="small" color={colors.berry} style={{ marginBottom: spacing.md }}>
              {error}
            </Txt>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="receipt-text-outline"
            title="No orders yet"
            body="Everything you order shows up here, with live tracking while it's on the way."
            action={<Button title="Find something good" onPress={() => navigation.getParent()?.navigate('HomeTab', { screen: 'RestaurantList' })} />}
          />
        }
        renderItem={({ item, index }) => {
          const isLive = live.includes(item);
          const count = item.items.reduce((n, i) => n + i.quantity, 0);
          return (
            <View>
              {index === 0 && isLive ? (
                <Txt variant="label" style={styles.groupLabel}>
                  On the way
                </Txt>
              ) : null}
              {index === live.length && rest.length ? (
                <Txt variant="label" style={styles.groupLabel}>
                  Earlier
                </Txt>
              ) : null}
              <Card onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })} style={[styles.card, isLive && styles.cardLive]}>
                <View style={styles.cardHead}>
                  <Txt variant="subheading" style={{ flex: 1 }} numberOfLines={1}>
                    {item.restaurantName}
                  </Txt>
                  <OrderStatusBadge status={item.paymentStatus === 'paid' ? item.status : item.paymentStatus === 'failed' ? 'rejected' : 'placed'} paymentStatus={item.paymentStatus} />
                </View>
                <Txt variant="small" numberOfLines={1} style={{ marginTop: 4 }}>
                  {item.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                </Txt>
                <View style={styles.cardFoot}>
                  <Txt variant="small">
                    {when(item.createdAt)} · {count} {count === 1 ? 'item' : 'items'}
                  </Txt>
                  <Txt variant="price" style={{ fontSize: 16 }}>
                    {rands(item.total)}
                  </Txt>
                </View>
                {isLive ? (
                  <View style={styles.trackRow}>
                    <Icon name="map-marker-path" size={16} color={colors.ember} />
                    <Txt variant="smallBold" color={colors.ember}>
                      Track live
                    </Txt>
                  </View>
                ) : item.status === 'delivered' && !item.rating ? (
                  <View style={styles.trackRow}>
                    <Icon name="star-outline" size={16} color={colors.mango} />
                    <Txt variant="smallBold" color={colors.inkSoft}>
                      Rate this order
                    </Txt>
                  </View>
                ) : null}
              </Card>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  list: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl * 2,
  },
  groupLabel: {
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  card: {
    marginBottom: spacing.md,
  },
  cardLive: {
    borderWidth: 1.5,
    borderColor: colors.ember,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardFoot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});
