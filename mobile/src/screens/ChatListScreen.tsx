import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { fetchConversations, imageSource } from '../api/client';
import { useChat } from '../context/ChatContext';
import Txt from '../components/Txt';
import Button from '../components/Button';
import { Avatar, Card, EmptyState, Icon, Skeleton } from '../components/ui';
import { colors, spacing } from '../theme';
import type { Conversation } from '../types';
import type { ChatsStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<ChatsStackParamList, 'ChatList'>;

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export default function ChatListScreen({ navigation }: Props) {
  const { refreshUnread } = useChat();
  const [threads, setThreads] = useState<Conversation[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setThreads(await fetchConversations());
      refreshUnread();
    } catch {
      setThreads((t) => t ?? []);
    }
  }, [refreshUnread]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const supportButton = (
    <Button
      title="Message MidFood"
      variant="dark"
      icon="lifebuoy"
      onPress={() => navigation.navigate('ChatThread', { title: 'MidFood support' })}
    />
  );

  if (!threads) {
    return (
      <View style={[styles.container, { padding: spacing.lg, gap: spacing.md }]}>
        <Skeleton height={84} />
        <Skeleton height={84} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={threads}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.ember}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="chat-outline"
            title="No chats yet"
            body="Message any store from its page or from an order. Quick questions get answered straight away; the kitchen answers the rest."
            action={supportButton}
          />
        }
        ListFooterComponent={threads.length ? <View style={{ marginTop: spacing.md }}>{supportButton}</View> : null}
        renderItem={({ item }) => {
          const unread = item.unread > 0;
          const who = item.lastSender === 'customer' ? 'You: ' : item.lastSender === 'bot' ? '' : '';
          return (
            <Card
              onPress={() => navigation.navigate('ChatThread', { conversationId: item.id, title: item.title })}
              style={[styles.row, unread && styles.rowUnread]}
            >
              {item.restaurantId ? (
                <Avatar uri={imageSource(item.thumbUrl)?.uri} name={item.title} color={item.heroColor} size={52} />
              ) : (
                <View style={styles.supportAvatar}>
                  <Icon name="lifebuoy" size={24} color={colors.onDark} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <View style={styles.rowHead}>
                  <Txt variant="subheading" numberOfLines={1} style={{ flex: 1 }}>
                    {item.title}
                  </Txt>
                  <Txt variant="small">{ago(item.lastMessageAt)}</Txt>
                </View>
                <Txt variant={unread ? 'smallBold' : 'small'} numberOfLines={1} color={unread ? colors.ink : colors.inkSoft}>
                  {who}
                  {item.lastMessage || 'Say hello'}
                </Txt>
              </View>
              {unread ? (
                <View style={styles.unreadDot}>
                  <Txt variant="smallBold" color={colors.onDark} style={{ fontSize: 11, lineHeight: 14 }}>
                    {item.unread}
                  </Txt>
                </View>
              ) : null}
            </Card>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  list: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl * 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  rowUnread: {
    borderWidth: 1.5,
    borderColor: colors.ember,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  supportAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.plum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDot: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.ember,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
