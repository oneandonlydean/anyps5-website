/**
 * Sorts the PS5's system libraries into areas for the progress page's library map, by name. The first rule that
 * matches wins, so the narrower rules (a PSN dialog, a video decoder) come before the broad ones (any dialog, any
 * video library). A library no rule knows goes under "System and storage".
 */

export const LIBRARY_AREAS = ["Core", "Graphics", "Audio and video", "Input", "Network and PSN", "Interface and text", "System and storage"] as const;
export type LibraryArea = (typeof LIBRARY_AREAS)[number];

const RULES: [LibraryArea, RegExp][] = [
  ["Core", /^(libc|libkernel.*|libSceLibcInternal|ulobjmgr|libmdbg_syscore)$/],
  ["Core", /^libSce(Fiber|Ult|Sysmodule|Rtc|Random|JobManager|Jemspace|SysCore|Ipmi|RazorCpu|AddressSanitizer|DbgThreadSanitizer|Mbus|SpSysCallWrapper)\b/],
  ["Network and PSN", /^libSce(Np|Net|Http|Ssl|LibreSsl|Rudp|NKWeb|WebBrowser|Remoteplay|PSNow|Login|Signin|UrlConfig|Companion|Share|SocialScreen|Invitation|PlayerInvitation|GameLiveStreaming|PlayReady|PosixForWebKit|Jsc|WkFont)/],
  ["Graphics", /^libSce(Agc|Gnm|VideoOut|Sdma|Composite)/],
  ["Input", /^libSce(Pad|Mouse|Keyboard|Move|Hid|Bluetooth|ConvertKeycode|SystemGesture|Ime|Vr|Hmd|Camera|Depth|VisionManager)/],
  [
    "Audio and video",
    /^libSce(Audio|Ajm|Ngs2|Opus|Vorbis|At9|M4aac|Ac3|Dts|Voice|ProprietaryVoiceChat|Vdec|Videodec|Venc|Video|AvPlayer|AvSetting|Avcap|Jpeg|Png|Jxr|EditMp4|GvMp4|Beisobmf|Bemp2sys|CustomMusic|MusicFramework|S3da|Dseehx|ScreenShot|Srcutl|SrcUtl|Esvm)/,
  ],
  ["Interface and text", /^libSce(Font|FreeType|Icu|Xml|Json|Zlib|Ces|TextToSpeech|SystemTts|.*Dialog)/],
];

export function libraryArea(name: string): LibraryArea {
  return RULES.find(([, rule]) => rule.test(name))?.[0] ?? "System and storage";
}
