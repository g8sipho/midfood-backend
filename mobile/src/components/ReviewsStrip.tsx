// "What people say" on a store's page: the average and count (or "New"),
// then up to five of the latest reviews side by side. Nothing at all until
// someone has rated.
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Txt from './Txt';
import { Icon } from './ui';
import { colors, radius, shadow, spacing } from '../theme';
import { shortDate } from '../schedule';
import type { RestaurantReviews } from '../types';

const SHOWN = 5;

export default function ReviewsStrip({ data }: { data: RestaurantReviews | null }) {
  if (!data || data.count === 0) return null;
  const cards = data.reviews.slice(0, SHOWN);

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Txt variant="heading">What people say</Txt>
        <View style={styles.score}>
          {data.average == null ? (
            <Txt variant="smallBold" color={colors.inkSoft}>
              New · {data.count} {data.count === 1 ? 'rating' : 'ratings'}
            </Txt>
          ) : (
            <>
              <Icon name="star" size={16} color={colors.mango} />
              <Txt variant="subheading">{data.average.toFixed(1)}</Txt>
              <Txt variant="small">
                · {data.count} {data.count === 1 ? 'rating' : 'ratings'}
              </Txt>
            </>
          )}
        </View>
      </View>
      {cards.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={styles.bleed}>
          {cards.map((r, i) => (
            <View key={`${r.ratedAt}-${i}`} style={[styles.card, shadow.card]}>
              <View style={styles.stars}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Icon key={n} name={n <= r.rating ? 'star' : 'star-outline'} size={14} color={n <= r.rating ? colors.mango : colors.sandDeep} />
                ))}
              </View>
              <Txt variant="body" numberOfLines={4} style={styles.words}>
                {r.review ? r.review : r.dishes.length ? `Had the ${r.dishes.slice(0, 2).join(' and ')}.` : 'Rated, no words.'}
              </Txt>
              <Txt variant="small" style={{ marginTop: 'auto' }}>
                {r.customerName} · {shortDate(r.ratedAt)}
              </Txt>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  score: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bleed: {
    marginHorizontal: -spacing.lg,
  },
  row: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 6,
    gap: spacing.md,
  },
  card: {
    width: 220,
    minHeight: 120,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  stars: {
    flexDirection: 'row',
    gap: 2,
    marginBottom: 6,
  },
  words: {
    fontSize: 13.5,
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
});
