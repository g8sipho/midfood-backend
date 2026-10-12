import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchOrders, fetchRestaurants, imageSource } from '../api/client';
import RestaurantCard from '../components/RestaurantCard';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { colors, radius, spacing } from '../theme/colors';
import type { Order, Restaurant } from '../types';
import type { HomeStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<HomeStackParamList, 'RestaurantList'>;

// The home feed: a greeting, a search box, shortcuts by kind of food, the
// places you've ordered from before, then every restaurant that's open
// (closed ones sink to the bottom rather than vanish).
export default function RestaurantListScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { itemCount } = useCart();
  const insets = useSafeAreaInsets();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [results, setResults] = useState<Restaurant[] | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState('');
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, mine] = await Promise.all([fetchRestaurants(), fetchOrders().catch(() => [])]);
      setRestaurants(list);
      setOrders(mine);
    } catch (err: any) {
      setError(err.message || 'Could not load restaurants.');
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

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

  const cuisines = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of restaurants) {
      const key = (r.cuisine || '').trim();
      if (key) seen.set(key, (seen.get(key) || 0) + 1);
    }
    return [...seen.keys()].sort((a, b) => a.localeCompare(b));
  }, [restaurants]);

  // Places ordered from before, most recent first, that are still listed.
  const orderAgain = useMemo(() => {
    const byId = new Map(restaurants.map((r) => [r.id, r]));
    const out: Restaurant[] = [];
    for (const o of [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const r = byId.get(o.restaurantId);
      if (r && !out.includes(r)) out.push(r);
      if (out.length === 6) break;
    }
    return out;
  }, [orders, restaurants]);

  const feed = useMemo(() => {
    const base = results ?? restaurants;
    const filtered = cuisine && !results ? base.filter((r) => r.cuisine === cuisine) : base;
    // Open restaurants first, then by rating, then by name.
    return [...filtered].sort((a, b) => {
      const ao = a.open === false ? 1 : 0;
      const bo = b.open === false ? 1 : 0;
      if (ao !== bo) return ao - bo;
      if ((b.rating || 0) !== (a.rating || 0)) return (b.rating || 0) - (a.rating || 0);
      return a.name.localeCompare(b.name);
    });
  }, [results, restaurants, cuisine]);

  const openCount = restaurants.filter((r) => r.open !== false).length;
  const firstName = user?.name?.split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const goTo = (r: Restaurant) => navigation.navigate('RestaurantDetail', { restaurantId: r.id });

  const header = (
    <View>
      <View style={[styles.hero, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.heroTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>
              {greeting}, {firstName}
            </Text>
            <Text style={styles.title}>What are you craving?</Text>
            <Text style={styles.place}>📍 Delivering in Middelburg</Text>
          </View>
          {itemCount > 0 && (
            <Pressable style={styles.cartPill} onPress={() => navigation.navigate('Cart')}>
              <Text style={styles.cartPillText}>🛒 {itemCount}</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.search}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search kotas, pizza, cakes, a restaurant…"
            placeholderTextColor={colors.textTertiary}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCorrect={false}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10}>
              <Text style={styles.searchClear}>✕</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {!results && cuisines.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip label="All" active={cuisine === null} onPress={() => setCuisine(null)} />
          {cuisines.map((c) => (
            <Chip key={c} label={c} active={cuisine === c} onPress={() => setCuisine(cuisine === c ? null : c)} />
          ))}
        </ScrollView>
      )}

      {!results && !cuisine && orderAgain.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order again</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.againRow}>
            {orderAgain.map((r) => {
              const img = imageSource(r.thumbUrl || r.imageUrl);
              return (
                <Pressable key={r.id} style={styles.againCard} onPress={() => goTo(r)}>
                  <View style={[styles.againImage, { backgroundColor: r.heroColor }]}>
                    {img ? (
                      <Image source={img} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    ) : (
                      <Text style={styles.againInitial}>{r.name.charAt(0)}</Text>
                    )}
                  </View>
                  <Text style={styles.againName} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={styles.againMeta}>{r.open === false ? 'Closed' : `${r.etaMinutes} min`}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {results
            ? searching
              ? 'Searching…'
              : results.length
                ? `${results.length} ${results.length === 1 ? 'match' : 'matches'} for “${query.trim()}”`
                : `Nothing found for “${query.trim()}”`
            : cuisine
              ? cuisine
              : openCount
                ? `${openCount} open now`
                : 'All restaurants'}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator style={styles.loading} color={colors.accentPrimary} />
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => load()}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={feed}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={header}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>{results ? 'No luck with that one' : 'No restaurants yet'}</Text>
              <Text style={styles.emptyText}>
                {results ? 'Try another word, or clear the search to browse.' : 'New places are joining MidFood every week.'}
              </Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => <RestaurantCard restaurant={item} onPress={() => goTo(item)} />}
        />
      )}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgApp,
  },
  hero: {
    backgroundColor: colors.accentPrimary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    marginHorizontal: -spacing.lg,
    marginBottom: spacing.md,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  greeting: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
    marginTop: 2,
  },
  place: {
    marginTop: 6,
    fontSize: 12,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '600',
  },
  cartPill: {
    backgroundColor: '#fff',
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  cartPillText: {
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 13,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    height: 48,
    gap: spacing.sm,
  },
  searchIcon: {
    fontSize: 15,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
  },
  searchClear: {
    fontSize: 14,
    color: colors.textSecondary,
    paddingHorizontal: 4,
  },
  chips: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  chip: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  chipActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  chipTextActive: {
    color: '#fff',
  },
  section: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  againRow: {
    gap: spacing.md,
    paddingRight: spacing.lg,
  },
  againCard: {
    width: 120,
  },
  againImage: {
    width: 120,
    height: 84,
    borderRadius: radius.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  againInitial: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '800',
  },
  againName: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  againMeta: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  loading: {
    marginTop: spacing.xxl,
  },
  centered: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  emptyText: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  error: {
    color: colors.accentError,
    textAlign: 'center',
  },
  retry: {
    marginTop: spacing.md,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  retryText: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
