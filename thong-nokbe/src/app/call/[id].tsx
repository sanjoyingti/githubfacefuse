import React, { useEffect, useRef, useState } from 'react';
import { Alert, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { onSnapshot } from '@react-native-firebase/firestore';
import { ChannelProfileType, ClientRoleType, createAgoraRtcEngine, RtcSurfaceView, type IRtcEngine } from 'react-native-agora';
import { useMe } from '../../context/AuthProvider';
import { agoraUid, callRef, getAgoraToken, leaveCall } from '../../lib/calls';
import { useUsers } from '../../lib/users';
import { AGORA_APP_ID } from '../../config';
import { colors } from '../../theme';
import type { Call, CallKind } from '../../lib/types';
import { Avatar } from '../../components/ui';

export default function CallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const { width, height } = useWindowDimensions();
  const engine = useRef<IRtcEngine | null>(null);
  const [call, setCall] = useState<Call | null>(null);
  const [kind, setKind] = useState<CallKind | null>(null); // fixed once the call doc loads
  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const [videoOff, setVideoOff] = useState<number[]>([]); // remote people who turned their camera off
  const [joined, setJoined] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
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
    else router.replace('/(tabs)/calls');
  };

  // Follow the call document: learn voice/video, close when the call ends.
  useEffect(() => {
    if (!id) return;
    return onSnapshot(callRef(id), (s) => {
      if (!s.exists()) return;
      const c = { id: s.id, ...(s.data() as Omit<Call, 'id'>) } as Call;
      setCall(c);
      setKind((k) => k ?? (c.kind === 'voice' ? 'voice' : 'video'));
      if (c.status === 'ended') hangUp();
      if (!c.isGroup && c.callerId === me.uid && c.invited.every((u) => c.declined?.includes(u))) {
        Alert.alert('Call declined', `${c.chatName} can't talk right now.`);
        hangUp();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Join the call room (room name = call id) once we know if it's voice or video.
  useEffect(() => {
    if (!id || !kind) return;
    if (!AGORA_APP_ID) {
      Alert.alert('Calling not set up', 'Set EXPO_PUBLIC_AGORA_APP_ID (see README) and rebuild the app.');
      hangUp();
      return;
    }
    const isVideo = kind === 'video';
    let cancelled = false;
    (async () => {
      if (Platform.OS === 'android') {
        await PermissionsAndroid.requestMultiple(
          isVideo ? [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.CAMERA] : [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO],
        );
      }
      const myUid = agoraUid(me.uid);
      let token: string;
      try {
        token = await getAgoraToken(id, myUid); // server only gives this to people in the call
      } catch (e: any) {
        Alert.alert("Can't join the call", e?.message ?? String(e));
        hangUp();
        return;
      }
      if (cancelled) return;
      const e = createAgoraRtcEngine();
      engine.current = e;
      e.initialize({ appId: AGORA_APP_ID, channelProfile: ChannelProfileType.ChannelProfileCommunication });
      e.registerEventHandler({
        onJoinChannelSuccess: () => setJoined(true),
        onUserJoined: (_c, uid) => setRemoteUids((l) => (l.includes(uid) ? l : [...l, uid])),
        onUserOffline: (_c, uid) => setRemoteUids((l) => l.filter((x) => x !== uid)),
        onUserMuteVideo: (_c, uid, muted) => setVideoOff((l) => (muted ? [...new Set([...l, uid])] : l.filter((x) => x !== uid))),
        onError: (err, msg) => console.warn('call error', err, msg),
      });
      e.enableAudio();
      if (isVideo) {
        e.enableVideo();
        e.startPreview();
      } else {
        e.disableVideo();
      }
      e.setDefaultAudioRouteToSpeakerphone(isVideo);
      setSpeakerOn(isVideo);
      e.joinChannel(token, id, myUid, {
        clientRoleType: ClientRoleType.ClientRoleBroadcaster,
        publishMicrophoneTrack: true,
        publishCameraTrack: isVideo,
        autoSubscribeAudio: true,
        autoSubscribeVideo: isVideo,
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
  }, [id, kind]);

  const someoneJoined = remoteUids.length > 0;
  useEffect(() => {
    if (!someoneJoined) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [someoneJoined]);

  const isVideo = kind === 'video';
  const title = call ? (call.isGroup ? call.chatName : call.callerId === me.uid ? call.chatName : call.callerName) : '';
  const tiles = remoteUids.length;
  const cols = tiles <= 1 ? 1 : 2;
  const rows = Math.ceil(Math.max(tiles, 1) / cols);
  const timer = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <View style={styles.root}>
      {tiles === 0 ? (
        <View style={styles.waiting}>
          <Avatar name={title} size={120} />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.sub}>{joined ? 'Ringing…' : 'Connecting…'}</Text>
          <Text style={styles.kindTag}>{isVideo ? '📹 Video call' : '📞 Voice call'}</Text>
        </View>
      ) : isVideo ? (
        <View style={styles.grid}>
          {remoteUids.map((u) => (
            <View key={u} style={{ width: width / cols, height: height / rows, backgroundColor: '#111' }}>
              {videoOff.includes(u) ? (
                <View style={styles.camOff}>
                  <Avatar name={nameForAgora(u)} size={80} />
                  <Text style={{ color: '#cbd5e1', marginTop: 8 }}>Camera off</Text>
                </View>
              ) : (
                <RtcSurfaceView canvas={{ uid: u }} style={{ flex: 1 }} />
              )}
              <Text style={styles.tileName}>{nameForAgora(u)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.voiceGrid}>
          {remoteUids.map((u) => (
            <View key={u} style={styles.voicePerson}>
              <Avatar name={nameForAgora(u)} size={tiles > 4 ? 70 : 96} />
              <Text style={styles.voiceName} numberOfLines={1}>
                {nameForAgora(u)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {isVideo && camOn && joined && (
        <View style={styles.self}>
          <RtcSurfaceView canvas={{ uid: 0 }} style={{ flex: 1 }} zOrderMediaOverlay />
        </View>
      )}

      <View style={styles.topBar}>
        <Text style={styles.topTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.topSub}>{tiles > 0 ? `${timer} · ${tiles + 1} people` : isVideo ? 'Video call' : 'Voice call'}</Text>
      </View>

      <View style={styles.controls}>
        <Ctrl
          icon={micOn ? 'mic' : 'mic-off'}
          label={micOn ? 'Mute' : 'Unmute'}
          active={!micOn}
          onPress={() => {
            engine.current?.muteLocalAudioStream(micOn);
            setMicOn(!micOn);
          }}
        />
        {isVideo ? (
          <>
            <Ctrl
              icon={camOn ? 'videocam' : 'videocam-off'}
              label={camOn ? 'Camera' : 'Camera off'}
              active={!camOn}
              onPress={() => {
                engine.current?.muteLocalVideoStream(camOn);
                if (camOn) engine.current?.stopPreview();
                else engine.current?.startPreview();
                setCamOn(!camOn);
              }}
            />
            <Ctrl icon="camera-reverse" label="Flip" onPress={() => engine.current?.switchCamera()} />
          </>
        ) : (
          <Ctrl
            icon={speakerOn ? 'volume-high' : 'volume-low'}
            label={speakerOn ? 'Speaker' : 'Phone'}
            active={speakerOn}
            onPress={() => {
              engine.current?.setEnableSpeakerphone(!speakerOn);
              setSpeakerOn(!speakerOn);
            }}
          />
        )}
        <View style={{ alignItems: 'center' }}>
          <Pressable style={[styles.ctrl, { backgroundColor: colors.unpaid }]} onPress={hangUp} accessibilityLabel="End call">
            <Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          </Pressable>
          <Text style={styles.ctrlLabel}>End</Text>
        </View>
      </View>
    </View>
  );
}

function Ctrl({ icon, label, onPress, active }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; active?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Pressable style={[styles.ctrl, active && { backgroundColor: '#fff' }]} onPress={onPress} accessibilityLabel={label}>
        <Ionicons name={icon} size={28} color={active ? '#000' : '#fff'} />
      </Pressable>
      <Text style={styles.ctrlLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f0d' },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 18, textAlign: 'center', paddingHorizontal: 20 },
  sub: { color: '#a7f3d0', marginTop: 6, fontSize: 17 },
  kindTag: { color: '#fff', marginTop: 16, fontSize: 16, fontWeight: '700' },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  camOff: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tileName: { position: 'absolute', left: 8, bottom: 8, color: '#fff', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden', fontWeight: '700' },
  voiceGrid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  voicePerson: { width: '33%', alignItems: 'center', marginVertical: 14 },
  voiceName: { color: '#fff', fontWeight: '700', marginTop: 8, fontSize: 15 },
  self: { position: 'absolute', right: 16, top: 110, width: 110, height: 160, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: '#fff', backgroundColor: '#222' },
  topBar: { position: 'absolute', top: 50, left: 16, right: 140 },
  topTitle: { color: '#fff', fontSize: 20, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 4 },
  topSub: { color: '#e2e8f0', marginTop: 2, fontSize: 15, textShadowColor: '#000', textShadowRadius: 4 },
  controls: { position: 'absolute', bottom: 36, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-evenly' },
  ctrl: { width: 66, height: 66, borderRadius: 33, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  ctrlLabel: { color: '#fff', marginTop: 6, fontWeight: '700', fontSize: 13 },
});
