// A titled row of small store tiles on the home screen ("Your favourites",
// "Order again"): the store's photo or initial, its name, and whether it's
// open.
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { imageSource } from '../api/client';
import Txt from './Txt';
import { Avatar, Icon, SectionTitle } from './ui';
import { colors, spacing } from '../theme';
import type { Restaurant } from '../types';

export default function StoreStrip({
  title,
  stores,
  onPress,
  hearts,
}: {
  title: string;
  stores: Restaurant[];
  onPress: (r: Restaurant) => void;
  // Show a small ember heart on each tile.
  hearts?: boolean;
}) {
  if (stores.length === 0) return null;
  return (
    <View style={styles.pad}>
      <SectionTitle title={title} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={{ marginHorizontal: -spacing.lg }}>
        {stores.map((r) => (
          <Pressable key={r.id} style={styles.tile} onPress={() => onPress(r)}>
            <View>
              <Avatar uri={imageSource(r.thumbUrl || r.imageUrl)?.uri} name={r.name} color={r.heroColor} size={64} square />
              {hearts ? (
                <View style={styles.heart}>
                  <Icon name="heart" size={11} color={colors.ember} />
                </View>
              ) : null}
            </View>
            <Txt variant="smallBold" numberOfLines={1} style={{ marginTop: 6 }}>
              {r.name}
            </Txt>
            <Txt variant="small" style={{ fontSize: 11.5 }}>
              {r.open === false ? 'Closed' : `${r.etaMinutes} min`}
            </Txt>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  row: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  tile: {
    width: 76,
  },
  heart: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
