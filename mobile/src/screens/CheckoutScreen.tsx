import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCart } from '../context/CartContext';
import { placeOrder } from '../api/client';
import Button from '../components/Button';
import { colors, radius, spacing } from '../theme/colors';
import type { HomeStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<HomeStackParamList, 'Checkout'>;

export default function CheckoutScreen({ navigation }: Props) {
  const { restaurant, lines, subtotal, clear } = useCart();
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!restaurant || lines.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>Your cart is empty.</Text>
      </View>
    );
  }

  const total = subtotal + restaurant.deliveryFee;

  async function handlePlaceOrder() {
    if (!restaurant) return;
    if (!address.trim()) {
      setError('Please enter a delivery address.');
      return;
    }
    // The driver phones the customer on arrival, so this isn't optional.
    if (!/^0\d{9}$/.test(phone.replace(/[\s-]/g, ''))) {
      setError('Please enter a valid 10-digit phone number, e.g. 082 123 4567.');
      return;
    }
    setError(null);
    setPlacing(true);
    try {
      const { order, paymentUrl } = await placeOrder({
        restaurantId: restaurant.id,
        items: lines.map((l) => ({ menuItemId: l.menuItem.id, quantity: l.quantity })),
        deliveryAddress: address.trim(),
        customerPhone: phone.replace(/[\s-]/g, ''),
        notes: notes.trim() || undefined,
      });
      clear();

      // The order already exists (payment status "pending") -- if PayFast is
      // configured, send the customer to pay for it now. Whatever happens in
      // that browser (paid, cancelled, closed early), we land on the order
      // screen next, which shows the real payment status and lets them retry.
      if (paymentUrl) {
        await WebBrowser.openBrowserAsync(paymentUrl);
      }

      navigation.getParent()?.navigate('OrdersTab', {
        screen: 'OrderDetail',
        params: { orderId: order.id },
      } as never);
    } catch (err: any) {
      setError(err.message || 'Could not place your order. Please try again.');
    } finally {
      setPlacing(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Delivery address</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 41 Turquoise St, Mineralia, Middelburg"
        placeholderTextColor={colors.textTertiary}
        value={address}
        onChangeText={setAddress}
        multiline
      />

      <Text style={styles.sectionTitle}>Contact number</Text>
      <TextInput
        style={[styles.input, styles.inputSingle]}
        placeholder="082 123 4567"
        placeholderTextColor={colors.textTertiary}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
      />
      <Text style={styles.inputHint}>Your driver calls this number when they arrive.</Text>

      <Text style={styles.sectionTitle}>Note for the restaurant (optional)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. no chilli, extra napkins, gate code 1234"
        placeholderTextColor={colors.textTertiary}
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      <Text style={styles.sectionTitle}>Order summary</Text>
      <View style={styles.card}>
        {lines.map((l) => (
          <View key={l.menuItem.id} style={styles.summaryLine}>
            <Text style={styles.summaryLineText}>
              {l.quantity}× {l.menuItem.name}
            </Text>
            <Text style={styles.summaryLineText}>R{l.menuItem.price * l.quantity}</Text>
          </View>
        ))}
        <View style={styles.divider} />
        <View style={styles.summaryLine}>
          <Text style={styles.summaryLineText}>Delivery fee</Text>
          <Text style={styles.summaryLineText}>R{restaurant.deliveryFee}</Text>
        </View>
        <View style={styles.summaryLine}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>R{total}</Text>
        </View>
      </View>

      <Text style={styles.note}>
        You'll be taken to PayFast to complete payment securely. Your order only reaches the
        restaurant once payment goes through.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button title={`Place order · R${total}`} onPress={handlePlaceOrder} loading={placing} />
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
    gap: spacing.sm,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  inputSingle: {
    minHeight: 0,
  },
  inputHint: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  input: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    color: colors.textPrimary,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  card: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 6,
  },
  summaryLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryLineText: {
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
  note: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    fontStyle: 'italic',
  },
  error: {
    color: colors.accentError,
    textAlign: 'center',
  },
});
