import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/lib/theme';
import { TermsModal } from './TermsModal';

export function TermsLink({ style }: { style?: StyleProp<ViewStyle> }) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="link"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.link, pressed && styles.pressed, style]}
      >
        <Text style={styles.text}>Terms &amp; Conditions &amp; Privacy Policy</Text>
      </Pressable>
      <TermsModal visible={visible} onClose={() => setVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'center', paddingVertical: 4 },
  text: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.slateMedium,
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  pressed: { opacity: 0.6 },
});
