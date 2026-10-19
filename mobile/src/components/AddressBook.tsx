// Saved addresses on the checkout: a row of "Home / Work / Gran's" chips
// above the address box, and the small "Save this address as…" row under it.
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Button from './Button';
import Txt from './Txt';
import { Field, Icon } from './ui';
import { colors, radius, spacing } from '../theme';
import type { SavedAddress } from '../types';

export function AddressChips({
  addresses,
  selectedId,
  onSelect,
}: {
  addresses: SavedAddress[];
  selectedId: string | null;
  onSelect: (address: SavedAddress) => void;
}) {
  if (addresses.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.bleed} keyboardShouldPersistTaps="handled">
      {addresses.map((a) => {
        const on = a.id === selectedId;
        return (
          <Pressable key={a.id} onPress={() => onSelect(a)} style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.85 }]}>
            <View style={styles.chipHead}>
              <Icon name={iconFor(a.label)} size={15} color={on ? colors.emberDeep : colors.ink} />
              <Txt variant="smallBold" color={on ? colors.emberDeep : colors.ink} numberOfLines={1}>
                {a.label}
              </Txt>
              {a.lat != null ? <Icon name="map-marker-check" size={13} color={on ? colors.emberDeep : colors.inkFaint} /> : null}
            </View>
            <Txt variant="small" numberOfLines={1} style={styles.chipLine}>
              {a.line}
            </Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// "Save this address as… [Home] Save". Compact: one line until opened. The
// parent unmounts it once the address is saved (it's a chip then).
export function SaveAddressRow({
  line,
  onSave,
  saving,
  note,
}: {
  line: string;
  onSave: (label: string) => void;
  saving: boolean;
  // A result line to show under the row: "Saved as Home." or an error.
  note: { text: string; tone: 'mint' | 'berry' } | null;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const clean = label.trim().slice(0, 30);

  return (
    <View style={{ marginTop: spacing.sm }}>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.saveToggle} hitSlop={6}>
        <Icon name={open ? 'bookmark' : 'bookmark-outline'} size={18} color={colors.ember} />
        <Txt variant="smallBold" color={colors.ember} style={{ flex: 1 }}>
          Save this address as…
        </Txt>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.inkFaint} />
      </Pressable>
      {open ? (
        <View style={styles.saveRow}>
          <Field placeholder="Home" value={label} onChangeText={setLabel} autoCapitalize="words" maxLength={30} returnKeyType="done" onSubmitEditing={() => clean && line.trim() && onSave(clean)} style={{ flex: 1 }} />
          <Button title="Save" variant="dark" size="sm" onPress={() => onSave(clean)} disabled={!clean || !line.trim()} loading={saving} style={styles.saveButton} />
        </View>
      ) : null}
      {note ? (
        <Txt variant="small" color={note.tone === 'mint' ? colors.mint : colors.berry} style={{ marginTop: 4 }}>
          {note.text}
        </Txt>
      ) : null}
    </View>
  );
}

function iconFor(label: string): 'home-outline' | 'briefcase-outline' | 'map-marker-outline' {
  const l = label.toLowerCase();
  if (/home|house|flat|room/.test(l)) return 'home-outline';
  if (/work|office|shop|school/.test(l)) return 'briefcase-outline';
  return 'map-marker-outline';
}

const styles = StyleSheet.create({
  bleed: {
    marginHorizontal: -spacing.lg,
    marginBottom: spacing.md,
  },
  chips: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  chip: {
    width: 168,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  chipOn: {
    backgroundColor: colors.emberSoft,
    borderColor: colors.ember,
  },
  chipHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  chipLine: {
    marginTop: 2,
    fontSize: 11.5,
    lineHeight: 15,
  },
  saveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  saveButton: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
});
