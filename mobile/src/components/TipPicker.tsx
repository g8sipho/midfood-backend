// "Tip your driver" on the checkout: a few set amounts, or their own.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Txt from './Txt';
import { Choice, Field } from './ui';
import { spacing } from '../theme';

const PRESETS = [0, 5, 10, 20];
export const MAX_TIP = 500;

export default function TipPicker({ value, onChange }: { value: number; onChange: (rands: number) => void }) {
  const [other, setOther] = useState(!PRESETS.includes(value));
  const [text, setText] = useState(other && value > 0 ? String(value) : '');

  const pickPreset = (n: number) => {
    setOther(false);
    setText('');
    onChange(n);
  };
  const pickOther = () => {
    setOther(true);
    onChange(parseTip(text));
  };

  return (
    <View>
      <View style={styles.row}>
        {PRESETS.map((n) => (
          <Choice key={n} label={`R${n}`} active={!other && value === n} onPress={() => pickPreset(n)} />
        ))}
        <Choice label="Other" active={other} onPress={pickOther} />
      </View>
      {other ? (
        <Field
          icon="cash"
          placeholder="Rands, up to 500"
          keyboardType="number-pad"
          value={text}
          onChangeText={(t) => {
            const clean = t.replace(/[^\d]/g, '').slice(0, 3);
            setText(clean);
            onChange(parseTip(clean));
          }}
          style={{ marginTop: spacing.md }}
        />
      ) : null}
      <Txt variant="small" style={{ marginTop: spacing.sm }}>
        100% goes to the driver.
      </Txt>
    </View>
  );
}

function parseTip(text: string) {
  const n = parseInt(text, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_TIP, n);
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
