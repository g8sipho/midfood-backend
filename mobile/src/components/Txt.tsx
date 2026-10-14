import React from 'react';
import { StyleProp, Text, TextProps, TextStyle } from 'react-native';
import { type } from '../theme';

type Variant = keyof typeof type;

// Every piece of text in the app goes through here, so the type scale in
// theme/index.ts is the only place a size or face is chosen.
export default function Txt({
  variant = 'body',
  color,
  center,
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: string; center?: boolean; style?: StyleProp<TextStyle> }) {
  return (
    <Text
      {...rest}
      style={[type[variant], color ? { color } : null, center ? { textAlign: 'center' } : null, style]}
    />
  );
}
