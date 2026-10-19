// "How was it?" on a delivered order: five stars, then a few words if they
// like. Stars save the moment they're tapped; the words go with "Send".
// Both can be changed afterwards.
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { rateOrder } from '../api/client';
import Button from './Button';
import Txt from './Txt';
import { Card, Field, Icon } from './ui';
import { colors, spacing } from '../theme';

const MAX_WORDS = 500;

export default function RateOrderCard({
  orderId,
  rating,
  review,
  onSaved,
}: {
  orderId: string;
  rating: number | null | undefined;
  review: string | null | undefined;
  onSaved: (rating: number, review: string | null) => void;
}) {
  const [stars, setStars] = useState(rating || 0);
  const [saved, setSaved] = useState<string | null>(review || null);
  const [draft, setDraft] = useState('');
  // The words box is open right after a first rating, or on "Edit".
  const [writing, setWriting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanked, setThanked] = useState(false);

  async function rate(n: number) {
    const before = stars;
    setStars(n);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      // Stars alone would wipe saved words, so they travel along.
      const res = await rateOrder(orderId, n, saved);
      onSaved(res.rating, res.review);
      if (!saved) setWriting(true);
    } catch (err: any) {
      setStars(before);
      setError(err.message || "Couldn't save your rating.");
    }
  }

  async function send() {
    if (!stars) return;
    setSending(true);
    setError(null);
    try {
      const words = draft.trim().slice(0, MAX_WORDS);
      const res = await rateOrder(orderId, stars, words || null);
      setSaved(res.review);
      setWriting(false);
      setThanked(true);
      onSaved(res.rating, res.review);
    } catch (err: any) {
      setError(err.message || "Couldn't send your words. Try again.");
    } finally {
      setSending(false);
    }
  }

  const rated = stars > 0;

  return (
    <Card style={styles.card}>
      <Txt variant="heading" center>
        {thanked ? 'Thanks for the words!' : rated ? 'Thanks for rating!' : 'How was it?'}
      </Txt>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => rate(n)} hitSlop={6}>
            <Icon name={n <= stars ? 'star' : 'star-outline'} size={38} color={n <= stars ? colors.mango : colors.sandDeep} />
          </Pressable>
        ))}
      </View>

      {writing ? (
        <View style={styles.words}>
          <Field
            placeholder="Say a few words (optional)"
            value={draft}
            onChangeText={(t) => setDraft(t.slice(0, MAX_WORDS))}
            multiline
            maxLength={MAX_WORDS}
            autoCapitalize="sentences"
          />
          <View style={styles.wordsRow}>
            <Txt variant="small" style={{ flex: 1 }}>
              Shown on their page with your first name.
            </Txt>
            <Button title="Send" variant="dark" size="sm" onPress={send} loading={sending} disabled={!draft.trim() && !saved} />
          </View>
        </View>
      ) : saved ? (
        <View style={styles.saved}>
          <Txt variant="body" center style={{ fontStyle: 'italic' }}>
            "{saved}"
          </Txt>
          <Pressable
            onPress={() => {
              setDraft(saved);
              setWriting(true);
              setThanked(false);
            }}
            hitSlop={8}
          >
            <Txt variant="smallBold" color={colors.ember}>
              Edit
            </Txt>
          </Pressable>
        </View>
      ) : (
        <View style={styles.saved}>
          <Txt variant="small" center>
            {rated ? 'Your rating helps the next hungry person choose.' : 'Tap a star. Only you and MidFood see who rated.'}
          </Txt>
          {rated ? (
            <Pressable onPress={() => setWriting(true)} hitSlop={8}>
              <Txt variant="smallBold" color={colors.ember}>
                Add a few words
              </Txt>
            </Pressable>
          ) : null}
        </View>
      )}

      {error ? (
        <Txt variant="small" color={colors.berry} center>
          {error}
        </Txt>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  stars: {
    flexDirection: 'row',
    gap: 6,
    marginVertical: spacing.xs,
  },
  words: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  wordsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  saved: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
  },
});
