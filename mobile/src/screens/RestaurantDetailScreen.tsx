import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchRestaurant, imageSource } from '../api/client';
import { useCart } from '../context/CartContext';
import Txt from '../components/Txt';
import Button from '../components/Button';
import { Chip, Icon, IconButton, Pill, Skeleton, Stepper } from '../components/ui';
import { colors, flame, radius, rands, shadow, spacing, tint } from '../theme';
import type { MenuItem, Restaurant } from '../types';
import type { HomeStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<HomeStackParamList, 'RestaurantDetail'>;
type MenuSection = { title: string; data: MenuItem[] };

// A store's page: the cover photo with the facts set on it, the menu in its
// sections with a row of section buttons that follows you down, a photo and
// an add control on every dish, and a tap on a dish to see it big.
export default function RestaurantDetailScreen({ route, navigation }: Props) {
  const { restaurantId, dishId } = route.params;
  const insets = useSafeAreaInsets();
  const { addItem, setQuantity, lines, itemCount, subtotal, restaurant: cartRestaurant } = useCart();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [activeSection, setActiveSection] = useState(0);
  const listRef = useRef<SectionList<MenuItem, MenuSection>>(null);

  useEffect(() => {
    fetchRestaurant(restaurantId)
      .then((r) => {
        setRestaurant(r);
        // Opened from a dish on the home screen: show that dish straight away.
        const dish = dishId ? (r.menu || []).find((m) => m.id === dishId) : null;
        if (dish) setSelected(dish);
      })
      .catch((err) => setError(err.message || 'Could not load this store.'))
      .finally(() => setLoading(false));
  }, [restaurantId, dishId]);

  const sections = useMemo<MenuSection[]>(() => {
    const menu = restaurant?.menu || [];
    const groups = new Map<string, MenuItem[]>();
    for (const item of menu) {
      const key = (item.category || '').trim() || 'Menu';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return [...groups.entries()].map(([title, data]) => ({ title, data }));
  }, [restaurant]);

  const closed = restaurant?.open === false;
  const switching = Boolean(cartRestaurant && restaurant && cartRestaurant.id !== restaurant.id);
  const inCart = cartRestaurant?.id === restaurant?.id ? lines : [];
  const quantityOf = (item: MenuItem) => inCart.find((l) => l.menuItem.id === item.id)?.quantity || 0;

  const add = (item: MenuItem) => {
    if (!restaurant) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    addItem(restaurant, item);
  };

  const jumpTo = (index: number) => {
    setActiveSection(index);
    listRef.current?.scrollToLocation({ sectionIndex: index, itemIndex: 0, viewOffset: 60, animated: true });
  };

  const openChat = () => {
    if (!restaurant) return;
    navigation.getParent()?.navigate('ChatsTab', {
      screen: 'ChatThread',
      params: { restaurantId: restaurant.id, title: restaurant.name },
    });
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <Skeleton height={300} round={0} />
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton height={36} width="60%" />
          <Skeleton height={110} round={radius.lg} />
          <Skeleton height={110} round={radius.lg} />
        </View>
        <IconButton name="arrow-left" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  if (error || !restaurant) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.lg }]}>
        <IconButton name="arrow-left" onPress={() => navigation.goBack()} />
        <Txt variant="body" color={colors.berry} style={{ marginTop: spacing.lg }}>
          {error || 'This store is no longer listed.'}
        </Txt>
      </View>
    );
  }

  const cover = imageSource(restaurant.imageUrl || restaurant.thumbUrl);

  const header = (
    <View>
      <View style={[styles.cover, { backgroundColor: tint(restaurant.heroColor, 0.4) }]}>
        {cover ? <Image source={cover} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <LinearGradient colors={['rgba(23,10,31,0.35)', 'rgba(23,10,31,0)', 'rgba(23,10,31,0.85)']} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />
        <View style={[styles.coverTop, { top: insets.top + spacing.sm }]}>
          <IconButton name="arrow-left" onPress={() => navigation.goBack()} />
          <IconButton name="chat-outline" onPress={openChat} />
        </View>
        <View style={styles.coverText}>
          <Txt variant="hero" color={colors.onDark} style={{ fontSize: 30, lineHeight: 34 }}>
            {restaurant.name}
          </Txt>
          <Txt variant="bodyMedium" color={colors.onDarkSoft}>
            {restaurant.cuisine}
          </Txt>
          <View style={styles.pills}>
            <Pill label={restaurant.rating == null ? 'New' : `${restaurant.rating.toFixed(1)} · ${restaurant.ratingCount} ratings`} icon={restaurant.rating == null ? undefined : 'star'} tone="light" />
            <Pill label={`${restaurant.etaMinutes} min`} icon="clock-outline" tone="light" />
            <Pill label={restaurant.deliveryFee === 0 ? 'Free delivery' : `${rands(restaurant.deliveryFee)} delivery`} icon="moped" tone="light" />
            <Pill label={closed ? 'Closed now' : 'Open'} tone={closed ? 'berry' : 'mint'} />
          </View>
        </View>
      </View>

      {closed ? (
        <Notice icon="moon-waning-crescent" text="This store is closed right now. Browse the menu and come back when it opens, or message them to ask when." />
      ) : switching ? (
        <Notice icon="cart-arrow-right" text={`Adding something here replaces the order you started at ${cartRestaurant?.name}.`} />
      ) : null}

      <Pressable onPress={openChat} style={styles.chatRow}>
        <View style={styles.chatIcon}>
          <Icon name="chat-processing-outline" size={20} color={colors.ember} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="subheading">Chat with {restaurant.name}</Txt>
          <Txt variant="small">Ask about the menu or your order. Quick questions are answered instantly.</Txt>
        </View>
        <Icon name="chevron-right" size={20} color={colors.inkFaint} />
      </Pressable>
    </View>
  );

  return (
    <View style={styles.container}>
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={header}
        contentContainerStyle={styles.menuList}
        onViewableItemsChanged={({ viewableItems }) => {
          const first = viewableItems.find((v) => v.section);
          if (first && first.section) {
            const idx = sections.findIndex((s) => s.title === first.section.title);
            if (idx >= 0) setActiveSection(idx);
          }
        }}
        viewabilityConfig={{ itemVisiblePercentThreshold: 40 }}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Txt variant="heading">{section.title}</Txt>
            <Txt variant="small">{section.data.length} {section.data.length === 1 ? 'item' : 'items'}</Txt>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Txt variant="body" color={colors.inkSoft}>
              This store hasn't loaded its menu yet.
            </Txt>
          </View>
        }
        renderItem={({ item }) => {
          const qty = quantityOf(item);
          const img = imageSource(item.thumbUrl || item.imageUrl);
          return (
            <Pressable onPress={() => setSelected(item)} style={({ pressed }) => [styles.dish, shadow.card, pressed && { opacity: 0.9 }]}>
              <View style={styles.dishInfo}>
                <Txt variant="subheading" numberOfLines={2}>
                  {item.name}
                </Txt>
                {item.description ? (
                  <Txt variant="small" numberOfLines={2} style={{ marginTop: 2 }}>
                    {item.description}
                  </Txt>
                ) : null}
                <Txt variant="price" color={colors.emberDeep} style={{ marginTop: 8 }}>
                  {rands(item.price)}
                </Txt>
              </View>
              <View style={styles.dishRight}>
                {img ? (
                  <Image source={img} style={styles.dishImage} resizeMode="cover" />
                ) : (
                  <View style={[styles.dishImage, styles.dishImageEmpty]}>
                    <Icon name="silverware-variant" size={28} color={colors.sandDeep} />
                  </View>
                )}
                {closed ? null : qty === 0 ? (
                  <Pressable onPress={() => add(item)} style={({ pressed }) => [styles.addButton, pressed && { backgroundColor: colors.ember }]} hitSlop={6}>
                    <Icon name="plus" size={20} color={colors.onDark} />
                  </Pressable>
                ) : (
                  <View style={styles.stepperWrap}>
                    <Stepper value={qty} onChange={(n) => setQuantity(item.id, n)} />
                  </View>
                )}
              </View>
            </Pressable>
          );
        }}
      />

      {/* Section buttons that follow you down the menu */}
      {sections.length > 1 ? (
        <View style={[styles.sectionBar, { top: insets.top + spacing.sm + 48 }]} pointerEvents="box-none">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sectionChips}>
            {sections.map((s, i) => (
              <Chip key={s.title} label={s.title} active={i === activeSection} onPress={() => jumpTo(i)} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {itemCount > 0 && cartRestaurant?.id === restaurant.id && (
        <Pressable onPress={() => navigation.getParent()?.navigate('CartTab', { screen: 'Cart' })} style={[styles.cartBar, { bottom: insets.bottom + spacing.lg }]}>
          <LinearGradient colors={[...flame]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.cartBarFill, shadow.ember]}>
            <View style={styles.cartBadge}>
              <Txt variant="smallBold" color={colors.onDark}>
                {itemCount}
              </Txt>
            </View>
            <Txt variant="button" style={{ flex: 1 }}>
              View your order
            </Txt>
            <Txt variant="button">{rands(subtotal)}</Txt>
            <Icon name="moped" size={24} color={colors.onDark} style={{ marginLeft: spacing.md }} />
          </LinearGradient>
        </Pressable>
      )}

      <DishSheet
        item={selected}
        quantity={selected ? quantityOf(selected) : 0}
        closed={closed}
        onClose={() => setSelected(null)}
        onAdd={(item) => add(item)}
        onQuantity={(item, n) => setQuantity(item.id, n)}
      />
    </View>
  );
}

function Notice({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.notice}>
      <Icon name={icon} size={18} color={colors.plum} />
      <Txt variant="small" color={colors.plum} style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

// A dish, big: the photo, the full description, how many to add.
function DishSheet({
  item,
  quantity,
  closed,
  onClose,
  onAdd,
  onQuantity,
}: {
  item: MenuItem | null;
  quantity: number;
  closed: boolean;
  onClose: () => void;
  onAdd: (item: MenuItem) => void;
  onQuantity: (item: MenuItem, n: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [count, setCount] = useState(1);
  useEffect(() => {
    setCount(1);
  }, [item?.id]);
  if (!item) return null;
  const img = imageSource(item.imageUrl || item.thumbUrl);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.sheetHandle} />
        {img ? (
          <Image source={img} style={styles.sheetImage} resizeMode="cover" />
        ) : (
          <View style={[styles.sheetImage, styles.dishImageEmpty]}>
            <Icon name="silverware-variant" size={44} color={colors.sandDeep} />
          </View>
        )}
        <View style={styles.sheetBody}>
          <Txt variant="title">{item.name}</Txt>
          {item.description ? (
            <Txt variant="body" color={colors.inkSoft} style={{ marginTop: 6 }}>
              {item.description}
            </Txt>
          ) : null}
          <View style={styles.sheetRow}>
            <Txt variant="priceBig" color={colors.emberDeep}>
              {rands(item.price)}
            </Txt>
            {closed ? <Pill label="Closed now" tone="berry" /> : quantity > 0 ? (
              <Stepper value={quantity} onChange={(n) => onQuantity(item, n)} size="lg" />
            ) : (
              <Stepper value={count} onChange={(n) => setCount(Math.max(1, n))} size="lg" />
            )}
          </View>
          {closed ? (
            <Button title="Back to the menu" variant="secondary" onPress={onClose} />
          ) : quantity > 0 ? (
            <Button title="Done" onPress={onClose} trailing={`${quantity} in your order`} />
          ) : (
            <Button
              title={`Add ${count > 1 ? `${count} ` : ''}to order`}
              trailing={rands(item.price * count)}
              onPress={() => {
                for (let i = 0; i < count; i += 1) onAdd(item);
                onClose();
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  centered: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  cover: {
    height: 320,
    justifyContent: 'flex-end',
  },
  coverTop: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  coverText: {
    padding: spacing.lg,
    gap: 2,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.sm,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.mangoSoft,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
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
  sectionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  sectionChips: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  menuList: {
    paddingBottom: 140,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  dish: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  dishInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  dishRight: {
    alignItems: 'center',
    width: 96,
  },
  dishImage: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
  },
  dishImageEmpty: {
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.plum,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.surface,
  },
  stepperWrap: {
    marginTop: -16,
  },
  cartBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    borderRadius: radius.lg,
  },
  cartBarFill: {
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cartBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: spacing.md,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(23,10,31,0.55)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  sheetHandle: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.8)',
    zIndex: 2,
  },
  sheetImage: {
    width: '100%',
    height: 260,
  },
  sheetBody: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: spacing.sm,
  },
});
