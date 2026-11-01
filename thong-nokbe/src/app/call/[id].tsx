import React, { useEffect, useRef, useState } from 'react';
import { Alert, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { onSnapshot } from '@react-native-firebase/firestore';
import {
  ChannelProfileType,
  ClientRoleType,
  createAgoraRtcEngine,
  RtcSurfaceView,
  type IRtcEngine,
} from 'react-native-agora';
import { useMe } from '../../context/AuthProvider';
import { agoraUid, callRef, getAgoraToken, leaveCall } from '../../lib/calls';
import { useUsers } from '../../lib/users';
import { AGORA_APP_ID } from '../../config';
import { colors } from '../../theme';
import type { Call } from '../../lib/types';
import { Avatar } from '../../components/ui';

export default function CallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const { width, height } = useWindowDimensions();
  const engine = useRef<IRtcEngine | null>(null);
  const [call, setCall] = useState<Call | null>(null);
  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const [joined, setJoined] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const leaving = useRef(false);

  const members = useUsers(call ? [call.callerId, ...call.invited] : []);
  const nameForAgora = (u: number) => Object.values(members).find((m) => agoraUid(m.uid) === u)?.name ?? 'Member';

  const hangUp = async () => {
    if (leaving.current) return;
    leaving.current = true;
    try {
      engine.current?.leaveChannel();
      engine.current?.release();
      engine.current = null;
    } catch {}
    await leaveCall(id!, me).catch(() => {});
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/chats');
  };

  // Follow the call document: close when the call ends.
  useEffect(() => {
    if (!id) return;
    return onSnapshot(callRef(id), (s) => {
      if (!s.exists()) return;
      const c = { id: s.id, ...(s.data() as Omit<Call, 'id'>) } as Call;
      setCall(c);
      if (c.status === 'ended') hangUp();
      // A 1:1 call that the other person declined.
      if (!c.isGroup && c.callerId === me.uid && c.invited.every((u) => c.declined?.includes(u))) {
        Alert.alert('Call declined');
        hangUp();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Join the Agora channel (channel name = call id).
  useEffect(() => {
    if (!id) return;
    if (!AGORA_APP_ID) {
      Alert.alert('Video calling not configured', 'Set EXPO_PUBLIC_AGORA_APP_ID (see README) and rebuild the app.');
      hangUp();
      return;
    }
    let cancelled = false;
    (async () => {
      if (Platform.OS === 'android') {
        await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.CAMERA]);
      }
      const myUid = agoraUid(me.uid);
      const token = await getAgoraToken(id, myUid);
      if (cancelled) return;
      const e = createAgoraRtcEngine();
      engine.current = e;
      e.initialize({ appId: AGORA_APP_ID, channelProfile: ChannelProfileType.ChannelProfileCommunication });
      e.registerEventHandler({
        onJoinChannelSuccess: () => setJoined(true),
        onUserJoined: (_c, uid) => setRemoteUids((l) => (l.includes(uid) ? l : [...l, uid])),
        onUserOffline: (_c, uid) => setRemoteUids((l) => l.filter((x) => x !== uid)),
        onError: (err, msg) => console.warn('agora error', err, msg),
      });
      e.enableVideo();
      e.startPreview();
      e.joinChannel(token, id, myUid, {
        clientRoleType: ClientRoleType.ClientRoleBroadcaster,
        publishCameraTrack: true,
        publishMicrophoneTrack: true,
        autoSubscribeAudio: true,
        autoSubscribeVideo: true,
      });
    })();
    return () => {
      cancelled = true;
      try {
        engine.current?.leaveChannel();
        engine.current?.release();
      } catch {}
      engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const someoneJoined = remoteUids.length > 0;
  useEffect(() => {
    if (!someoneJoined) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [someoneJoined]);

  const title = call ? (call.isGroup ? call.chatName : call.callerId === me.uid ? call.chatName : call.callerName) : '';
  const tiles = remoteUids.length;
  const cols = tiles <= 1 ? 1 : 2;
  const rows = Math.ceil(Math.max(tiles, 1) / cols);
  const tileW = width / cols;
  const tileH = height / rows;

  return (
    <View style={styles.root}>
      {tiles === 0 ? (
        <View style={styles.waiting}>
          <Avatar name={title} size={110} />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.sub}>{joined ? (call?.isGroup ? 'Ringing members…' : 'Ringing…') : 'Connecting…'}</Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {remoteUids.map((u) => (
            <View key={u} style={{ width: tileW, height: tileH }}>
              <RtcSurfaceView canvas={{ uid: u }} style={{ flex: 1 }} />
              <Text style={styles.tileName}>{nameForAgora(u)}</Text>
            </View>
          ))}
        </View>
      )}

      {camOn && joined && (
        <View style={styles.self}>
          <RtcSurfaceView canvas={{ uid: 0 }} style={{ flex: 1 }} zOrderMediaOverlay />
        </View>
      )}

      <View style={styles.topBar}>
        <Text style={styles.topTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.topSub}>
          {tiles > 0 ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} · ${tiles + 1} in call` : 'Video call'}
        </Text>
      </View>

      <View style={styles.controls}>
        <Ctrl
          icon={micOn ? 'mic' : 'mic-off'}
          onPress={() => {
            engine.current?.muteLocalAudioStream(micOn);
            setMicOn(!micOn);
          }}
          active={!micOn}
        />
        <Ctrl
          icon={camOn ? 'videocam' : 'videocam-off'}
          onPress={() => {
            engine.current?.muteLocalVideoStream(camOn);
            if (camOn) engine.current?.stopPreview();
            else engine.current?.startPreview();
            setCamOn(!camOn);
          }}
          active={!camOn}
        />
        <Ctrl icon="camera-reverse" onPress={() => engine.current?.switchCamera()} />
        <Pressable style={[styles.ctrl, { backgroundColor: colors.unpaid }]} onPress={hangUp}>
          <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
        </Pressable>
      </View>
    </View>
  );
}

function Ctrl({ icon, onPress, active }: { icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void; active?: boolean }) {
  return (
    <Pressable style={[styles.ctrl, active && { backgroundColor: '#fff' }]} onPress={onPress}>
      <Ionicons name={icon} size={26} color={active ? '#000' : '#fff'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f0d' },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 18 },
  sub: { color: '#a7f3d0', marginTop: 6 },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  tileName: { position: 'absolute', left: 8, bottom: 8, color: '#fff', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  self: { position: 'absolute', right: 16, top: 100, width: 110, height: 160, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: '#fff', backgroundColor: '#222' },
  topBar: { position: 'absolute', top: 50, left: 16, right: 140 },
  topTitle: { color: '#fff', fontSize: 18, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 4 },
  topSub: { color: '#e2e8f0', marginTop: 2, textShadowColor: '#000', textShadowRadius: 4 },
  controls: { position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-evenly' },
  ctrl: { width: 62, height: 62, borderRadius: 31, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
});
