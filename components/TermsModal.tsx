import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { TERMS_URL } from '@/lib/env';
import { TERMS_HTML } from '@/lib/legal.generated';
import { colors, shadows, spacing } from '@/lib/theme';

export function TermsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [useBundledTerms, setUseBundledTerms] = useState(false);
  const source = TERMS_URL && !useBundledTerms ? { uri: TERMS_URL } : { html: TERMS_HTML };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.titleWrap}>
            <Text style={styles.eyebrow}>GalliRent</Text>
            <Text style={styles.title}>Terms &amp; Privacy Policy</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close terms" onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={24} color={colors.slateDark} />
          </Pressable>
        </View>
        <WebView
          source={source}
          originWhitelist={['*']}
          javaScriptEnabled={false}
          startInLoadingState
          showsVerticalScrollIndicator
          style={styles.webview}
          onError={() => setUseBundledTerms(true)}
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={colors.emerald} />
            </View>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    ...shadows.soft,
  },
  titleWrap: { flex: 1 },
  eyebrow: { fontSize: 11, fontWeight: '700', color: colors.emerald, letterSpacing: 1, textTransform: 'uppercase' },
  title: { fontSize: 18, fontWeight: '700', color: colors.slateDark, marginTop: 2 },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  webview: { flex: 1, backgroundColor: colors.surface },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
