import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchCategories, fetchFavourites, fetchFeaturedDishes, fetchOrders, fetchRestaurants, imageSource, setFavourite } from '../api/client';
import RestaurantCard from '../components/RestaurantCard';
import StoreStrip from '../components/StoreStrip';
import Txt from '../components/Txt';
import { EmptyState, Icon, SectionTitle, Skeleton } from '../components/ui';
import Button from '../components/Button';
import { useAuth } from '../context/AuthContext';
import { colors, fonts, night, radius, shadow, spacing } from '../theme';
import type { Category, FeaturedDish, Order, Restaurant } from '../types';
import type { HomeStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<HomeStackParamList, 'RestaurantList'>;

const SCREEN_W = Dimensions.get('window').width;
const BANNER_W = SCREEN_W - spacing.lg * 2;
const rand = (n: number) => `R${Number(n).toFixed(2).replace(/\.00$/, '')}`;

const LIVE_STATUS: Record<string, { label: string; icon: string }> = {
  placed: { label: 'Waiting for the kitchen', icon: 'timer-sand' },
  confirmed: { label: 'Kitchen accepted it', icon: 'check-circle-outline' },
  preparing: { label: 'Being cooked now', icon: 'stove' },
  out_for_delivery: { label: 'On the way to you', icon: 'moped' },
};

// Home. A plum sky with an ember sun, the search floating off its edge, the
// category tiles, the places you've ordered from, then every store in town
// (open ones first; closed ones sink rather than vanish).
export default function RestaurantListScreen({ navigation }: Props) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [results, setResults] = useState<Restaurant[] | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [dishes, setDishes] = useState<FeaturedDish[]>([]);
  const [favIds, setFavIds] = useState<string[]>([]);
  const [bannerIndex, setBannerIndex] = useState(0);
  const bannerRef = useRef<ScrollView>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, cats, mine, food] = await Promise.all([
        fetchRestaurants(),
        fetchCategories().catch(() => []),
        fetchOrders().catch(() => []),
        fetchFeaturedDishes(12).catch(() => []),
      ]);
      setRestaurants(list);
      setCategories(cats);
      setOrders(mine);
      setDishes(food);
    } catch (err: any) {
      setError(err.message || 'Could not load the stores.');
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
    // Favourites once; a signed-out or expired session just means none.
    fetchFavourites()
      .then(setFavIds)
      .catch(() => {});
  }, [load]);

  // The heart flips at once; the server is told after, and a failure flips
  // it back.
  const toggleFavourite = (r: Restaurant) => {
    const on = !favIds.includes(r.id);
    setFavIds((prev) => (on ? [...prev.filter((id) => id !== r.id), r.id] : prev.filter((id) => id !== r.id)));
    setFavourite(r.id, on).catch(() => {
      setFavIds((prev) => (on ? prev.filter((id) => id !== r.id) : [...prev.filter((id) => id !== r.id), r.id]));
    });
  };

  // The big food banners turn over on their own every few seconds.
  const banners = dishes.slice(0, 4);
  const popular = dishes.slice(4).length >= 3 ? dishes.slice(4) : dishes;
  useEffect(() => {
    if (banners.length < 2) return;
    const t = setInterval(() => {
      setBannerIndex((i) => {
        const next = (i + 1) % banners.length;
        bannerRef.current?.scrollTo({ x: next * (BANNER_W + spacing.sm), animated: true });
        return next;
      });
    }, 4500);
    return () => clearInterval(t);
  }, [banners.length]);

  const openDish = (d: FeaturedDish) => navigation.navigate('RestaurantDetail', { restaurantId: d.restaurantId, dishId: d.id });

  // Searching asks the server (it looks inside menus too), a moment after
  // the customer stops typing.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        setResults(await fetchRestaurants(q));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Places ordered from before, most recent first, that are still listed.
  const orderAgain = useMemo(() => {
    const byId = new Map(restaurants.map((r) => [r.id, r]));
    const out: Restaurant[] = [];
    for (const o of [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const r = byId.get(o.restaurantId);
      if (r && !out.includes(r)) out.push(r);
      if (out.length === 8) break;
    }
    return out;
  }, [orders, restaurants]);

  // The stores they've hearted, in the order they hearted them, still listed.
  const favourites = useMemo(() => {
    const byId = new Map(restaurants.map((r) => [r.id, r]));
    return favIds.map((id) => byId.get(id)).filter((r): r is Restaurant => Boolean(r));
  }, [favIds, restaurants]);

  // Open first, then favourites, then by rating.
  const feed = useMemo(() => {
    const base = results ?? restaurants;
    const filtered = category && !results ? base.filter((r) => (r.categories || []).includes(category)) : base;
    return [...filtered].sort((a, b) => {
      const ao = a.open === false ? 1 : 0;
      const bo = b.open === false ? 1 : 0;
      if (ao !== bo) return ao - bo;
      const af = favIds.includes(a.id) ? 0 : 1;
      const bf = favIds.includes(b.id) ? 0 : 1;
      if (af !== bf) return af - bf;
      if ((b.rating || 0) !== (a.rating || 0)) return (b.rating || 0) - (a.rating || 0);
      return a.name.localeCompare(b.name);
    });
  }, [results, restaurants, category, favIds]);

  // The order that's cooking or on its way right now, if there is one.
  const liveOrder = useMemo(
    () =>
      [...orders]
        .filter((o) => o.paymentStatus === 'paid' && LIVE_STATUS[o.status])
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null,
    [orders]
  );

  const openCount = restaurants.filter((r) => r.open !== false).length;
  const firstName = user?.name?.split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const activeCategory = categories.find((c) => c.key === category);

  const goTo = (r: Restaurant) => navigation.navigate('RestaurantDetail', { restaurantId: r.id });

  const header = (
    <View>
      {/* The sky */}
      <LinearGradient colors={[...night]} start={{ x: 0, y: 0 }} end={{ x: 0.2, y: 1 }} style={[styles.hero, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.sun} />
        <View style={styles.sunGlow} />
        <View style={styles.brandRow}>
          <Image source={require('../../assets/logo-white.png')} style={styles.brandLogo} resizeMode="contain" />
          <View style={styles.placePill}>
            <Icon name="map-marker" size={14} color={colors.ember} />
            <Txt variant="smallBold" color={colors.onDark} style={{ fontSize: 11.5 }}>
              Middelburg
            </Txt>
          </View>
        </View>
        <Txt variant="smallBold" color={colors.onDarkSoft} style={{ marginTop: spacing.lg }}>
          {greeting}, {firstName}
        </Txt>
        <Txt variant="hero" color={colors.onDark} style={styles.headline}>
          What are we{'\n'}bringing you?
        </Txt>
      </LinearGradient>

      {/* The search, floating off the sky's edge */}
      <View style={[styles.search, shadow.float]}>
        <Icon name="magnify" size={22} color={colors.inkFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder="Kotas, pizza, medicine, a shop…"
          placeholderTextColor={colors.inkFaint}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCorrect={false}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10} style={styles.searchClear}>
            <Icon name="close" size={16} color={colors.ink} />
          </Pressable>
        ) : null}
      </View>

      {/* Your order, while it's live */}
      {!loading && !results && liveOrder && (
        <Pressable
          onPress={() => navigation.getParent()?.navigate('OrdersTab', { screen: 'OrderDetail', params: { orderId: liveOrder.id } })}
          style={({ pressed }) => [styles.live, shadow.card, pressed && { opacity: 0.92 }]}
        >
          <View style={styles.liveIcon}>
            <MaterialCommunityIcons name={LIVE_STATUS[liveOrder.status].icon as any} size={22} color={colors.onDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="subheading" color={colors.onDark} numberOfLines={1}>
              {LIVE_STATUS[liveOrder.status].label}
            </Txt>
            <Txt variant="small" color={colors.onDarkSoft} numberOfLines={1}>
              {liveOrder.restaurantName} · R{Number(liveOrder.total).toFixed(0)}
            </Txt>
          </View>
          <View style={styles.liveTrack}>
            <Txt variant="smallBold" color={colors.onDark}>
              Track
            </Txt>
            <Icon name="chevron-right" size={16} color={colors.onDark} />
          </View>
        </Pressable>
      )}

      {/* Food banners: real dishes from the stores, big */}
      {!loading && !results && !category && banners.length > 0 && (
        <View style={{ marginTop: spacing.lg }}>
          <ScrollView
            ref={bannerRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={BANNER_W + spacing.sm}
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
            onMomentumScrollEnd={(e) => setBannerIndex(Math.round(e.nativeEvent.contentOffset.x / (BANNER_W + spacing.sm)))}
          >
            {banners.map((d) => (
              <Pressable key={d.id} onPress={() => openDish(d)} style={({ pressed }) => [styles.banner, shadow.float, pressed && { transform: [{ scale: 0.99 }] }]}>
                <Image source={imageSource(d.imageUrl)!} style={StyleSheet.absoluteFill} resizeMode="cover" />
                <LinearGradient colors={['rgba(23,10,31,0)', 'rgba(23,10,31,0.15)', 'rgba(23,10,31,0.88)']} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />
                <View style={styles.bannerTag}>
                  <Txt variant="smallBold" color={colors.ink} style={{ fontSize: 11.5 }} numberOfLines={1}>
                    {d.restaurantName}
                  </Txt>
                </View>
                <View style={styles.bannerFoot}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="title" color={colors.onDark} numberOfLines={2} style={styles.bannerTitle}>
                      {d.name}
                    </Txt>
                    <Txt variant="smallBold" color={colors.onDarkSoft}>
                      {d.restaurantOpen === false ? 'Closed now · order later' : `${d.etaMinutes} min · delivered`}
                    </Txt>
                  </View>
                  <View style={styles.bannerPrice}>
                    <Txt variant="subheading" color={colors.onDark}>
                      {rand(d.price)}
                    </Txt>
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
          {banners.length > 1 && (
            <View style={styles.dots}>
              {banners.map((d, i) => (
                <View key={d.id} style={[styles.dot, i === bannerIndex && styles.dotOn]} />
              ))}
            </View>
          )}
        </View>
      )}

      {loading ? (
        <View style={styles.pad}>
          <Skeleton height={200} round={radius.lg} style={{ marginBottom: spacing.xl }} />
          <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} width={76} height={92} round={radius.md} />
            ))}
          </View>
          <Skeleton height={220} round={radius.lg} style={{ marginBottom: spacing.lg }} />
          <Skeleton height={220} round={radius.lg} />
        </View>
      ) : null}

      {/* The stores they've hearted, first */}
      {!loading && !results && !category && <StoreStrip title="Your favourites" stores={favourites} onPress={goTo} hearts />}

      {/* Category tiles */}
      {!loading && !results && categories.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles}>
          {categories.map((c) => {
            const active = category === c.key;
            return (
              <Pressable
                key={c.key}
                onPress={() => setCategory(active ? null : c.key)}
                style={({ pressed }) => [styles.tile, active && styles.tileActive, pressed && { opacity: 0.85 }]}
              >
                <View style={[styles.tileIcon, active && styles.tileIconActive]}>
                  <MaterialCommunityIcons name={c.icon as any} size={26} color={active ? colors.onDark : colors.ember} />
                </View>
                <Txt variant="smallBold" center color={active ? colors.onDark : colors.ink} style={styles.tileLabel} numberOfLines={2}>
                  {c.label}
                </Txt>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Popular dishes, straight to the dish */}
      {!loading && !results && !category && popular.length > 0 && (
        <View style={styles.pad}>
          <SectionTitle title="Popular right now" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dishRow} style={{ marginHorizontal: -spacing.lg }}>
            {popular.map((d) => (
              <Pressable key={d.id} onPress={() => openDish(d)} style={({ pressed }) => [styles.dishCard, shadow.card, pressed && { opacity: 0.9 }]}>
                <Image source={imageSource(d.thumbUrl || d.imageUrl)!} style={styles.dishImg} resizeMode="cover" />
                <View style={styles.dishAdd}>
                  <Icon name="plus" size={18} color={colors.onDark} />
                </View>
                <View style={{ padding: spacing.sm + 2 }}>
                  <Txt variant="smallBold" numberOfLines={2} style={{ minHeight: 34 }}>
                    {d.name}
                  </Txt>
                  <Txt variant="small" numberOfLines={1} style={{ fontSize: 11.5 }}>
                    {d.restaurantName}
                  </Txt>
                  <Txt variant="price" color={colors.ember} style={{ marginTop: 4 }}>
                    {rand(d.price)}
                  </Txt>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Order again */}
      {!loading && !results && !category && <StoreStrip title="Order again" stores={orderAgain} onPress={goTo} />}

      {!loading && (
        <View style={[styles.pad, { paddingBottom: 0 }]}>
          <SectionTitle
            title={
              results
                ? searching
                  ? 'Searching…'
                  : results.length
                    ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}`
                    : 'No matches'
                : activeCategory
                  ? activeCategory.label
                  : openCount
                    ? `Open now`
                    : 'All stores'
            }
            action={category ? 'Show all' : undefined}
            onAction={category ? () => setCategory(null) : undefined}
          />
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      {error && !loading ? (
        <View style={{ paddingTop: insets.top + spacing.xxl }}>
          <EmptyState
            icon="wifi-off"
            title="Can't reach MidFood"
            body={error}
            action={<Button title="Try again" variant="dark" onPress={() => load()} />}
          />
        </View>
      ) : (
        <FlatList
          data={loading ? [] : feed}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={header}
          ListEmptyComponent={
            loading ? null : (
              <EmptyState
                icon={results ? 'magnify-close' : 'storefront-outline'}
                title={results ? 'Nothing by that name' : activeCategory ? `No ${activeCategory.label.toLowerCase()} yet` : 'No stores yet'}
                body={
                  results
                    ? 'Try another word, or clear the search to browse.'
                    : 'New stores are joining MidFood every week. Know one? Tell them about us.'
                }
              />
            )
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ember} />}
          renderItem={({ item }) => (
            <View style={styles.pad}>
              <RestaurantCard restaurant={item} onPress={() => goTo(item)} favourite={favIds.includes(item.id)} onToggleFavourite={() => toggleFavourite(item)} />
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  hero: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl + spacing.lg,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    overflow: 'hidden',
  },
  sun: {
    position: 'absolute',
    top: -40,
    right: -30,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: colors.ember,
    opacity: 0.9,
  },
  sunGlow: {
    position: 'absolute',
    top: -90,
    right: -80,
    width: 290,
    height: 290,
    borderRadius: 145,
    backgroundColor: colors.flameStart,
    opacity: 0.18,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandLogo: {
    width: 128,
    height: 32,
  },
  placePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  headline: {
    marginTop: 4,
    fontSize: 32,
    lineHeight: 36,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    height: 56,
    marginHorizontal: spacing.lg,
    marginTop: -28,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.ink,
  },
  searchClear: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pad: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    backgroundColor: colors.plum,
    borderRadius: radius.lg,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.sm + 2,
    paddingRight: spacing.md,
  },
  liveIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.ember,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 6,
  },
  tiles: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    gap: spacing.sm,
  },
  tile: {
    width: 80,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: 4,
    borderRadius: radius.md,
  },
  tileActive: {
    backgroundColor: colors.plum,
  },
  tileIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    ...(shadow.card as object),
  },
  tileIconActive: {
    backgroundColor: colors.ember,
  },
  tileLabel: {
    fontSize: 11,
    lineHeight: 14,
  },
  banner: {
    width: BANNER_W,
    height: 210,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.plum,
    justifyContent: 'flex-end',
  },
  bannerTag: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    maxWidth: BANNER_W - spacing.md * 2,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  bannerFoot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
  },
  bannerTitle: {
    fontSize: 22,
    lineHeight: 26,
  },
  bannerPrice: {
    backgroundColor: colors.ember,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.sandDeep,
  },
  dotOn: {
    width: 18,
    backgroundColor: colors.ember,
  },
  dishRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 6,
    gap: spacing.md,
  },
  dishCard: {
    width: 152,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  dishImg: {
    width: 152,
    height: 132,
    backgroundColor: colors.sand,
  },
  dishAdd: {
    position: 'absolute',
    top: 132 - 18,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.surface,
  },
  list: {
    paddingBottom: spacing.xxxl * 2,
  },
});
