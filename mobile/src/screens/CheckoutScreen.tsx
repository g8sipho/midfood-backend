import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Location from 'expo-location';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { placeOrder } from '../api/client';
import Button from '../components/Button';
import Txt from '../components/Txt';
import { Card, Divider, Field, Icon, Pill } from '../components/ui';
import { colors, radius, rands, spacing } from '../theme';
import type { CartStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CartStackParamList, 'Checkout'>;

const ADDRESS_KEY = 'midfood.lastAddress';

// A pin is only kept if the phone is sure to about this many metres;
// a vague fix would send the driver to the wrong street.
const GOOD_FIX_METRES = 100;

export default function CheckoutScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { restaurant, lines, subtotal, clear } = useCart();
  const { user } = useAuth();
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState(user?.phone || '');
  const [notes, setNotes] = useState('');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pinning, setPinning] = useState(false);
  const [pinNote, setPinNote] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The last address used, so a repeat order is two taps.
  useEffect(() => {
    AsyncStorage.getItem(ADDRESS_KEY).then((saved) => {
      if (saved) setAddress(saved);
    });
  }, []);

  if (!restaurant || lines.length === 0) {
    return (
      <View style={styles.centered}>
        <Txt variant="body" color={colors.inkSoft}>
          Your order is empty.
        </Txt>
      </View>
    );
  }

  const total = subtotal + restaurant.deliveryFee;

  async function pinLocation() {
    setPinning(true);
    setPinNote(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setPinNote("Location is off for MidFood. Your typed address still works; a pin just helps the driver find the gate.");
        return;
      }
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if ((fix.coords.accuracy || 999) > GOOD_FIX_METRES) {
        setPinNote("Your phone isn't sure where you are yet. Step outside or wait a moment, then try again.");
        return;
      }
      setPin({ lat: fix.coords.latitude, lng: fix.coords.longitude });
      setPinNote(`Pinned to about ${Math.round(fix.coords.accuracy || 0)} m. The driver gets this with your address.`);
    } catch {
      setPinNote("Couldn't get a fix right now. Your address is enough.");
    } finally {
      setPinning(false);
    }
  }

  async function handlePlaceOrder() {
    if (!restaurant) return;
    if (!address.trim()) {
      setError('Enter the address to deliver to.');
      return;
    }
    const cleanPhone = phone.replace(/[\s-]/g, '');
    if (!/^0\d{9}$/.test(cleanPhone)) {
      setError('Enter a 10-digit cellphone number, like 082 123 4567.');
      return;
    }
    setError(null);
    setPlacing(true);
    try {
      const { order, paymentUrl } = await placeOrder({
        restaurantId: restaurant.id,
        items: lines.map((l) => ({ menuItemId: l.menuItem.id, quantity: l.quantity })),
        deliveryAddress: address.trim(),
        customerPhone: cleanPhone,
        notes: notes.trim() || undefined,
        deliveryLat: pin?.lat,
        deliveryLng: pin?.lng,
      });
      AsyncStorage.setItem(ADDRESS_KEY, address.trim()).catch(() => {});
      clear();
      if (paymentUrl) {
        await WebBrowser.openBrowserAsync(paymentUrl);
      }
      navigation.getParent()?.navigate('OrdersTab', { screen: 'OrderDetail', params: { orderId: order.id } });
    } catch (err: any) {
      setError(err.message || "Couldn't place the order. Check your connection and try again.");
    } finally {
      setPlacing(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]} keyboardShouldPersistTaps="handled">
        <Card>
          <Txt variant="heading" style={{ marginBottom: spacing.md }}>
            Where to?
          </Txt>
          <Field
            label="Delivery address"
            icon="home-map-marker"
            placeholder="41 Turquoise St, Mineralia"
            value={address}
            onChangeText={setAddress}
            multiline
          />
          <Pressable onPress={pinLocation} disabled={pinning} style={[styles.pinRow, pin && styles.pinRowDone]}>
            <Icon name={pin ? 'map-marker-check' : 'crosshairs-gps'} size={20} color={pin ? colors.mint : colors.ember} />
            <View style={{ flex: 1 }}>
              <Txt variant="smallBold" color={pin ? colors.mint : colors.ember}>
                {pinning ? 'Finding you…' : pin ? 'Location pinned' : 'Pin my location for the driver'}
              </Txt>
              {pinNote ? <Txt variant="small">{pinNote}</Txt> : null}
            </View>
          </Pressable>
          <Field
            label="Cellphone number"
            icon="phone-outline"
            placeholder="082 123 4567"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            hint="The driver calls this number at the gate."
            style={{ marginTop: spacing.md }}
          />
          <Field
            label="Note for the kitchen"
            icon="note-text-outline"
            placeholder="No chilli, extra napkins, gate code…"
            value={notes}
            onChangeText={setNotes}
            multiline
            style={{ marginTop: spacing.md }}
          />
        </Card>

        <Card style={{ marginTop: spacing.lg }}>
          <View style={styles.summaryHead}>
            <Txt variant="heading">{restaurant.name}</Txt>
            <Pill label={`${restaurant.etaMinutes} min`} icon="clock-outline" />
          </View>
          {lines.map((l) => (
            <View key={l.menuItem.id} style={styles.summaryLine}>
              <Txt variant="body" style={{ flex: 1 }}>
                {l.quantity} × {l.menuItem.name}
              </Txt>
              <Txt variant="bodyMedium">{rands(l.menuItem.price * l.quantity)}</Txt>
            </View>
          ))}
          <Divider />
          <View style={styles.summaryLine}>
            <Txt variant="body" color={colors.inkSoft}>
              Delivery
            </Txt>
            <Txt variant="bodyMedium">{restaurant.deliveryFee === 0 ? 'Free' : rands(restaurant.deliveryFee)}</Txt>
          </View>
          <View style={styles.summaryLine}>
            <Txt variant="subheading">Total</Txt>
            <Txt variant="priceBig" color={colors.emberDeep} style={{ fontSize: 22 }}>
              {rands(total)}
            </Txt>
          </View>
        </Card>

        <View style={styles.secure}>
          <Icon name="shield-check-outline" size={18} color={colors.mint} />
          <Txt variant="small" style={{ flex: 1 }}>
            You pay on a secure payment page (card or Instant EFT). The kitchen only sees the order once it's paid.
          </Txt>
        </View>

        {error ? (
          <Txt variant="bodyMedium" color={colors.berry} center style={{ marginBottom: spacing.md }}>
            {error}
          </Txt>
        ) : null}

        <Button title="Pay and place order" trailing={rands(total)} icon="moped" onPress={handlePlaceOrder} loading={placing} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    padding: spacing.lg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.emberSoft,
  },
  pinRowDone: {
    backgroundColor: colors.mintSoft,
  },
  summaryHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  summaryLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 4,
  },
  secure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
});
