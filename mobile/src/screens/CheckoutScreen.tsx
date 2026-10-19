import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Location from 'expo-location';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { checkPromo, fetchAddresses, fetchRestaurant, isApiError, placeOrder, saveAddress } from '../api/client';
import Button from '../components/Button';
import Txt from '../components/Txt';
import { Card, Divider, Field, Icon, Pill } from '../components/ui';
import { AddressChips, SaveAddressRow } from '../components/AddressBook';
import SchedulePicker from '../components/SchedulePicker';
import TipPicker from '../components/TipPicker';
import PromoRow from '../components/PromoRow';
import { formatSchedule } from '../schedule';
import { colors, radius, rands, spacing } from '../theme';
import type { PromoCheck, SavedAddress } from '../types';
import type { CartStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CartStackParamList, 'Checkout'>;

const ADDRESS_KEY = 'midfood.lastAddress';

// A pin is only kept if the phone is sure to about this many metres;
// a vague fix would send the driver to the wrong street.
const GOOD_FIX_METRES = 100;

type Note = { text: string; tone: 'mint' | 'berry' };

export default function CheckoutScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { restaurant, lines, subtotal, clear, refreshPrices } = useCart();
  const { user } = useAuth();
  const [address, setAddress] = useState('');
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressNote, setAddressNote] = useState<Note | null>(null);
  const [phone, setPhone] = useState(user?.phone || '');
  const [notes, setNotes] = useState('');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  // Where the pin came from: the phone's GPS, or a saved address.
  const [pinFrom, setPinFrom] = useState<'gps' | 'saved' | null>(null);
  const [pinning, setPinning] = useState(false);
  const [pinNote, setPinNote] = useState<string | null>(null);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [tip, setTip] = useState(0);
  const [promo, setPromo] = useState<PromoCheck | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Saved addresses first (most recently used on top); failing those, the
  // last address typed, so a repeat order is two taps either way.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [last, list] = await Promise.all([
        AsyncStorage.getItem(ADDRESS_KEY).catch(() => null),
        fetchAddresses().catch(() => [] as SavedAddress[]),
      ]);
      if (!alive) return;
      setAddresses(list);
      if (list.length > 0) {
        setAddress(list[0].line);
        setAddressId(list[0].id);
        if (list[0].lat != null && list[0].lng != null) {
          setPin({ lat: list[0].lat, lng: list[0].lng });
          setPinFrom('saved');
        }
      } else if (last) {
        setAddress(last);
      }
    })();
    return () => {
      alive = false;
    };
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

  const discount = promo ? promo.discount : 0;
  const total = subtotal - discount + restaurant.deliveryFee + tip;

  function chooseAddress(a: SavedAddress) {
    setAddress(a.line);
    setAddressId(a.id);
    setAddressNote(null);
    if (a.lat != null && a.lng != null) {
      setPin({ lat: a.lat, lng: a.lng });
      setPinFrom('saved');
      setPinNote(`Pinned from "${a.label}". The driver gets this with your address.`);
    } else if (pinFrom === 'saved') {
      setPin(null);
      setPinFrom(null);
      setPinNote(null);
    }
  }

  function typeAddress(text: string) {
    setAddress(text);
    if (!addressId) return;
    // They're changing a saved address: it's a new one now, and a pin that
    // belonged to the old one shouldn't travel with it.
    setAddressId(null);
    if (pinFrom === 'saved') {
      setPin(null);
      setPinFrom(null);
      setPinNote(null);
    }
  }

  async function saveThisAddress(label: string) {
    setSavingAddress(true);
    setAddressNote(null);
    try {
      const saved = await saveAddress({ label, line: address.trim(), lat: pin?.lat ?? null, lng: pin?.lng ?? null });
      setAddresses((prev) => [saved, ...prev.filter((a) => a.id !== saved.id && a.label.toLowerCase() !== saved.label.toLowerCase())]);
      setAddressId(saved.id);
      setAddressNote({ text: `Saved as ${saved.label}.`, tone: 'mint' });
    } catch (err: any) {
      setAddressNote({ text: err.message || "Couldn't save the address.", tone: 'berry' });
    } finally {
      setSavingAddress(false);
    }
  }

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
      setPinFrom('gps');
      setPinNote(`Pinned to about ${Math.round(fix.coords.accuracy || 0)} m. The driver gets this with your address.`);
    } catch {
      setPinNote("Couldn't get a fix right now. Your address is enough.");
    } finally {
      setPinning(false);
    }
  }

  async function applyPromo(code: string) {
    if (!restaurant) return;
    setPromoChecking(true);
    setPromoError(null);
    try {
      setPromo(await checkPromo({ code, restaurantId: restaurant.id, subtotal }));
    } catch (err: any) {
      setPromoError(err.message || "Couldn't check that code. Try again.");
    } finally {
      setPromoChecking(false);
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
        addressId: addressId || undefined,
        promoCode: promo?.code,
        tip: tip > 0 ? tip : undefined,
        scheduledFor: scheduledFor || undefined,
        expectedTotal: total,
      });
      AsyncStorage.setItem(ADDRESS_KEY, address.trim()).catch(() => {});
      clear();
      if (paymentUrl) {
        await WebBrowser.openBrowserAsync(paymentUrl);
      }
      navigation.getParent()?.navigate('OrdersTab', { screen: 'OrderDetail', params: { orderId: order.id } });
    } catch (err: any) {
      if (isApiError(err) && err.body?.promoRejected) {
        // The code stopped applying between the check and the order.
        setPromo(null);
        setPromoError(err.message);
        setError('The promo code came off. Check the total and try again.');
      } else if (isApiError(err) && err.body?.priceChanged) {
        setError(err.message);
        // Bring the prices up to date so the next try matches the server.
        fetchRestaurant(restaurant.id)
          .then((fresh) => {
            refreshPrices(fresh);
            if (promo) applyPromo(promo.code);
          })
          .catch(() => {});
      } else {
        setError(err.message || "Couldn't place the order. Check your connection and try again.");
      }
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
          <AddressChips addresses={addresses} selectedId={addressId} onSelect={chooseAddress} />
          <Field
            label="Delivery address"
            icon="home-map-marker"
            placeholder="41 Turquoise St, Mineralia"
            value={address}
            onChangeText={typeAddress}
            multiline
          />
          {address.trim() && !addressId ? (
            <SaveAddressRow line={address} onSave={saveThisAddress} saving={savingAddress} note={addressNote} />
          ) : addressNote ? (
            <Txt variant="small" color={addressNote.tone === 'mint' ? colors.mint : colors.berry} style={{ marginTop: 6 }}>
              {addressNote.text}
            </Txt>
          ) : null}
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
          <Txt variant="heading" style={{ marginBottom: spacing.md }}>
            When?
          </Txt>
          <SchedulePicker value={scheduledFor} onChange={setScheduledFor} />
        </Card>

        <Card style={{ marginTop: spacing.lg }}>
          <Txt variant="heading" style={{ marginBottom: spacing.md }}>
            Tip your driver
          </Txt>
          <TipPicker value={tip} onChange={setTip} />
        </Card>

        <Card style={{ marginTop: spacing.lg }}>
          <View style={styles.summaryHead}>
            <Txt variant="heading">{restaurant.name}</Txt>
            <Pill label={scheduledFor ? formatSchedule(scheduledFor) : `${restaurant.etaMinutes} min`} icon="clock-outline" tone={scheduledFor ? 'ember' : 'neutral'} />
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
          <PromoRow
            applied={promo}
            error={promoError}
            checking={promoChecking}
            onApply={applyPromo}
            onRemove={() => {
              setPromo(null);
              setPromoError(null);
            }}
          />
          <Divider />
          <SummaryLine label="Food" value={rands(subtotal)} />
          {promo ? <SummaryLine label={`Promo · ${promo.code}`} value={`−${rands(discount)}`} tone={colors.mint} /> : null}
          <SummaryLine label="Delivery" value={restaurant.deliveryFee === 0 ? 'Free' : rands(restaurant.deliveryFee)} />
          {tip > 0 ? <SummaryLine label="Tip" value={rands(tip)} /> : null}
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

        {scheduledFor ? (
          <View style={styles.forLater}>
            <Icon name="clock-outline" size={16} color={colors.emberDeep} />
            <Txt variant="smallBold" color={colors.emberDeep}>
              For {formatSchedule(scheduledFor)}
            </Txt>
          </View>
        ) : null}
        <Button title="Pay and place order" trailing={rands(total)} icon="moped" onPress={handlePlaceOrder} loading={placing} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SummaryLine({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.summaryLine}>
      <Txt variant="body" color={tone || colors.inkSoft}>
        {label}
      </Txt>
      <Txt variant="bodyMedium" color={tone}>
        {value}
      </Txt>
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
  forLater: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: spacing.sm,
  },
});
