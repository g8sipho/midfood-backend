import React from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { imageSource } from '../api/client';
import { useCart } from '../context/CartContext';
import Button from '../components/Button';
import Txt from '../components/Txt';
import { Avatar, Card, Divider, EmptyState, Icon, Stepper } from '../components/ui';
import { colors, radius, rands, spacing } from '../theme';
import type { CartStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CartStackParamList, 'Cart'>;

export default function CartScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { restaurant, lines, subtotal, setQuantity } = useCart();

  if (!restaurant || lines.length === 0) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon="moped"
          title="Nothing on the way yet"
          body="Pick a store on Home and add a few things. Your order collects here."
          action={<Button title="Browse stores" onPress={() => navigation.getParent()?.navigate('HomeTab', { screen: 'RestaurantList' })} />}
        />
      </View>
    );
  }

  const total = subtotal + restaurant.deliveryFee;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.storeRow}>
          <Avatar uri={imageSource(restaurant.thumbUrl || restaurant.imageUrl)?.uri} name={restaurant.name} color={restaurant.heroColor} size={48} square />
          <View style={{ flex: 1 }}>
            <Txt variant="small">Your order from</Txt>
            <Txt variant="heading">{restaurant.name}</Txt>
          </View>
          <Icon name="clock-outline" size={16} color={colors.inkSoft} />
          <Txt variant="smallBold">{restaurant.etaMinutes} min</Txt>
        </View>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {lines.map((l, i) => {
            const img = imageSource(l.menuItem.thumbUrl || l.menuItem.imageUrl);
            return (
              <View key={l.menuItem.id} style={[styles.line, i > 0 && styles.lineBorder]}>
                {img ? <Image source={img} style={styles.lineImage} /> : <View style={[styles.lineImage, { backgroundColor: colors.sand }]} />}
                <View style={{ flex: 1 }}>
                  <Txt variant="subheading" numberOfLines={2}>
                    {l.menuItem.name}
                  </Txt>
                  <Txt variant="small">{rands(l.menuItem.price)} each</Txt>
                  <Txt variant="price" color={colors.emberDeep} style={{ marginTop: 4, fontSize: 16 }}>
                    {rands(l.menuItem.price * l.quantity)}
                  </Txt>
                </View>
                <Stepper value={l.quantity} onChange={(n) => setQuantity(l.menuItem.id, n)} />
              </View>
            );
          })}
        </Card>

        <Button
          title="Add more from this store"
          variant="ghost"
          icon="plus-circle-outline"
          onPress={() => navigation.getParent()?.navigate('HomeTab', { screen: 'RestaurantDetail', params: { restaurantId: restaurant.id } })}
          style={{ marginTop: spacing.sm }}
        />
      </ScrollView>

      <View style={[styles.summary, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.summaryRow}>
          <Txt variant="body" color={colors.inkSoft}>
            Food
          </Txt>
          <Txt variant="bodyMedium">{rands(subtotal)}</Txt>
        </View>
        <View style={styles.summaryRow}>
          <Txt variant="body" color={colors.inkSoft}>
            Delivery
          </Txt>
          <Txt variant="bodyMedium">{restaurant.deliveryFee === 0 ? 'Free' : rands(restaurant.deliveryFee)}</Txt>
        </View>
        <Divider style={{ marginVertical: spacing.sm }} />
        <View style={styles.summaryRow}>
          <Txt variant="heading">Total</Txt>
          <Txt variant="priceBig" color={colors.emberDeep} style={{ fontSize: 24 }}>
            {rands(total)}
          </Txt>
        </View>
        <Button title="Checkout" icon="moped" onPress={() => navigation.navigate('Checkout')} style={{ marginTop: spacing.md }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  lineBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  lineImage: {
    width: 60,
    height: 60,
    borderRadius: radius.sm,
  },
  summary: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: 6,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
