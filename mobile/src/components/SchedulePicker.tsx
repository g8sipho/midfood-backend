// "When?" on the checkout: as soon as possible, or a day and a half-hour
// slot up to a week ahead. Built from Choice pills; no date-picker library.
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Txt from './Txt';
import { Choice } from './ui';
import { spacing } from '../theme';
import { scheduleDays, slotTime, type ScheduleDay } from '../schedule';

export default function SchedulePicker({ value, onChange }: { value: string | null; onChange: (iso: string | null) => void }) {
  const [later, setLater] = useState(Boolean(value));
  const [days, setDays] = useState<ScheduleDay[]>(() => scheduleDays());
  const [dayIndex, setDayIndex] = useState(0);

  // The first slot today creeps forward as the minutes pass; refresh the
  // list now and then so a stale "18:30" can't be picked at 18:00.
  useEffect(() => {
    if (!later) return;
    const t = setInterval(() => setDays(scheduleDays()), 60000);
    return () => clearInterval(t);
  }, [later]);

  // "Today" drops off the list once its last slot has passed.
  const shownDay = Math.min(dayIndex, days.length - 1);
  const day = days[shownDay];
  const chosenDay = useMemo(() => (value ? days.findIndex((d) => d.slots.includes(value)) : -1), [days, value]);

  // If the chosen slot has slipped into the past, drop it.
  useEffect(() => {
    if (value && later && chosenDay === -1) onChange(null);
  }, [value, later, chosenDay, onChange]);

  const pickAsap = () => {
    setLater(false);
    onChange(null);
  };
  const pickLater = () => {
    setLater(true);
    if (chosenDay >= 0) setDayIndex(chosenDay);
  };

  return (
    <View>
      <View style={styles.row}>
        <Choice label="As soon as possible" active={!later} onPress={pickAsap} />
        <Choice label="Later today / another day" active={later} onPress={pickLater} />
      </View>
      {later && day ? (
        <View style={{ marginTop: spacing.md }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow} style={styles.bleed} keyboardShouldPersistTaps="handled">
            {days.map((d, i) => (
              <Choice key={d.label} label={d.label} active={i === shownDay} onPress={() => setDayIndex(i)} />
            ))}
          </ScrollView>
          <View style={styles.grid}>
            {day.slots.map((iso) => (
              <Choice key={iso} label={slotTime(iso)} active={iso === value} onPress={() => onChange(iso)} style={styles.slot} />
            ))}
          </View>
          <Txt variant="small" style={{ marginTop: spacing.sm }}>
            {value ? 'The kitchen gets it in time to have it at your door then.' : 'Pick a time. The kitchen starts in good time for it.'}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  bleed: {
    marginHorizontal: -spacing.lg,
  },
  dayRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  slot: {
    minWidth: 68,
    paddingHorizontal: 10,
  },
});
