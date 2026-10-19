// The promo code line in the checkout summary: a box and "Apply", which
// becomes a green "WELCOME50 — R50 off" with an × once the server says yes.
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Button from './Button';
import Txt from './Txt';
import { Field, Icon } from './ui';
import { colors, spacing } from '../theme';
import type { PromoCheck } from '../types';

export default function PromoRow({
  applied,
  error,
  checking,
  onApply,
  onRemove,
}: {
  applied: PromoCheck | null;
  // The server's reason, shown in berry under the box.
  error: string | null;
  checking: boolean;
  onApply: (code: string) => void;
  onRemove: () => void;
}) {
  const [code, setCode] = useState('');

  if (applied) {
    return (
      <View style={styles.applied}>
        <Icon name="tag-outline" size={18} color={colors.mint} />
        <Txt variant="bodyMedium" color={colors.mint} style={{ flex: 1 }}>
          {applied.code} — {applied.description}
        </Txt>
        <Pressable
          onPress={() => {
            setCode('');
            onRemove();
          }}
          hitSlop={10}
          style={styles.remove}
        >
          <Icon name="close" size={16} color={colors.ink} />
        </Pressable>
      </View>
    );
  }

  const clean = code.trim().toUpperCase();
  return (
    <View>
      <View style={styles.row}>
        <Field
          icon="tag-outline"
          placeholder="Promo code"
          autoCapitalize="characters"
          autoCorrect={false}
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          onSubmitEditing={() => clean && onApply(clean)}
          returnKeyType="done"
          style={{ flex: 1 }}
        />
        <Button title="Apply" variant="dark" size="sm" onPress={() => onApply(clean)} disabled={clean.length < 3} loading={checking} style={styles.button} />
      </View>
      {error ? (
        <Txt variant="small" color={colors.berry} style={{ marginTop: 6 }}>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  button: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  applied: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.mintSoft,
    borderRadius: 12,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  remove: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
