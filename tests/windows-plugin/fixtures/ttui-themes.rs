//! Named palettes inspired by popular editor themes; stable IDs are saved in config.
use ratatui::style::{Color, Modifier, Style};
use serde::{Deserialize, Serialize};

macro_rules! themes {
    ($( $id:ident, $name:literal, [$($color:expr),+]; )+) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
        #[serde(rename_all = "lowercase")]
        pub enum Theme {
            $($id,)+
            #[default]
            #[serde(other)]
            Dark,
        }
        impl Theme {
            pub const ALL: &'static [Self] = &[Self::Dark, $(Self::$id,)+];
            pub fn name(self) -> &'static str {
                match self { Self::Dark => "T-TUI Dark", $(Self::$id => $name,)+ }
            }
            pub fn palette(self) -> Palette {
                let colors = match self {
                    Self::Dark => [0x101218,0x171a22,0xe9e7e5,0x969ba8,0x303542,0xff7c89,0x31222d,0x372331,0x83ccad,0xffa17a],
                    $(Self::$id => [$($color),+],)+
                };
                let [bg,panel,fg,dim,line,accent,selected,own,good,error] = colors.map(|c| Color::Rgb((c >> 16) as u8, (c >> 8) as u8, c as u8));
                Palette { bg,panel,fg,dim,line,accent,selected,own,good,error }
            }
        }
    }
}
themes! {
    Light, "T-TUI Light", [0xf6f3f0,0xfffdfa,0x25232c,0x686774,0xdad3d1,0xa82f49,0xf7e3e5,0xf5e0e8,0x227657,0x9d411a];
    Dracula, "Dracula", [0x282a36,0x21222c,0xf8f8f2,0xa0a9cf,0x44475a,0xbd93f9,0x44475a,0x373047,0x50fa7b,0xff5555];
    CatppuccinMocha, "Catppuccin Mocha", [0x1e1e2e,0x181825,0xcdd6f4,0xa6adc8,0x45475a,0xcba6f7,0x313244,0x38304b,0xa6e3a1,0xf38ba8];
    CatppuccinMacchiato, "Catppuccin Macchiato", [0x24273a,0x1e2030,0xcad3f5,0xa5adcb,0x494d64,0xc6a0f6,0x363a4f,0x3b3451,0xa6da95,0xed8796];
    CatppuccinFrappe, "Catppuccin Frappe", [0x303446,0x292c3c,0xc6d0f5,0xa5adce,0x51576d,0xca9ee6,0x414559,0x48405b,0xa6d189,0xe78284];
    CatppuccinLatte, "Catppuccin Latte", [0xeff1f5,0xe6e9ef,0x4c4f69,0x626880,0xbcc0cc,0x8839ef,0xdce0e8,0xe1d6f1,0x407900,0xd20f39];
    Nord, "Nord", [0x2e3440,0x272c36,0xeceff4,0xb0baca,0x4c566a,0x88c0d0,0x3b4252,0x384956,0xa3be8c,0xbf616a];
    Gruvbox, "Gruvbox Dark", [0x282828,0x1d2021,0xebdbb2,0xbdae93,0x504945,0xfabd2f,0x3c3836,0x49402f,0xb8bb26,0xfb4934];
    GruvboxLight, "Gruvbox Light", [0xfbf1c7,0xf2e5bc,0x3c3836,0x665c54,0xbdae93,0x9d0006,0xebdbb2,0xe4d5b1,0x586400,0xaf3a03];
    TokyoNight, "Tokyo Night", [0x1a1b26,0x16161e,0xc0caf5,0x9aa5ce,0x414868,0x7aa2f7,0x292e42,0x263651,0x9ece6a,0xf7768e];
    TokyoStorm, "Tokyo Night Storm", [0x24283b,0x1f2335,0xc0caf5,0xa9b1d6,0x414868,0xbb9af7,0x343b58,0x3c3456,0x9ece6a,0xf7768e];
    TokyoDay, "Tokyo Night Day", [0xe1e2e7,0xd5d6db,0x343b58,0x565f89,0xa1a6c5,0x2e7de9,0xc4c8da,0xc2d3eb,0x336c2c,0xb52b50];
    OneDark, "One Dark", [0x282c34,0x21252b,0xabb2bf,0x9da5b4,0x4b5263,0x61afef,0x3e4451,0x303f50,0x98c379,0xe06c75];
    OneLight, "One Light", [0xfafafa,0xf0f0f0,0x383a42,0x696c77,0xc6c7cc,0x4078f2,0xe2e5ed,0xdde7f7,0x507a14,0xe45649];
    SolarizedDark, "Solarized Dark", [0x002b36,0x073642,0x93a1a1,0x839496,0x586e75,0x2aa198,0x134753,0x0b4547,0x99a900,0xdc322f];
    SolarizedLight, "Solarized Light", [0xfdf6e3,0xeee8d5,0x586e75,0x657b83,0x93a1a1,0x087f87,0xe0ddca,0xd8e4d8,0x687900,0xdc322f];
    RosePine, "Rose Pine", [0x191724,0x1f1d2e,0xe0def4,0xaaa5c3,0x403d52,0xc4a7e7,0x403d52,0x383149,0x9ccfd8,0xeb6f92];
    RosePineMoon, "Rose Pine Moon", [0x232136,0x2a273f,0xe0def4,0xaaa5c3,0x44415a,0xea9a97,0x44415a,0x483549,0x9ccfd8,0xeb6f92];
    RosePineDawn, "Rose Pine Dawn", [0xfaf4ed,0xfffaf3,0x575279,0x797593,0xcecacd,0x907aa9,0xf2e9e1,0xece1eb,0x286983,0xb4637a];
    Monokai, "Monokai", [0x272822,0x1e1f1c,0xf8f8f2,0xb0ad9e,0x49483e,0xf92672,0x49483e,0x47313c,0xa6e22e,0xfd971f];
    MaterialOcean, "Material Ocean", [0x0f111a,0x090b10,0xeeffff,0x8f9bb3,0x3b4256,0x82aaff,0x292d3e,0x22304a,0xc3e88d,0xf07178];
    GithubDark, "GitHub Dark", [0x0d1117,0x161b22,0xe6edf3,0x8b949e,0x30363d,0x79c0ff,0x21262d,0x1c3049,0x7ee787,0xff7b72];
    GithubLight, "GitHub Light", [0xffffff,0xf6f8fa,0x1f2328,0x59636e,0xd0d7de,0x0969da,0xddf4ff,0xddeeff,0x1a7f37,0xcf222e];
}

#[derive(Clone, Copy)]
pub struct Palette {
    pub bg: Color,
    pub panel: Color,
    pub fg: Color,
    pub dim: Color,
    pub line: Color,
    pub accent: Color,
    pub selected: Color,
    pub own: Color,
    pub good: Color,
    pub error: Color,
}
impl Palette {
    pub fn new(theme: Theme) -> Self {
        theme.palette()
    }
    pub fn base(self) -> Style {
        Style::default().fg(self.fg)
    }
    pub fn dim(self) -> Style {
        self.base().fg(self.dim)
    }
    pub fn accent(self) -> Style {
        self.base().fg(self.accent).add_modifier(Modifier::BOLD)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_palettes_roundtrip_and_old_configs_keep_working() {
        for theme in Theme::ALL {
            let json = serde_json::to_string(theme).unwrap();
            assert_eq!(*theme, serde_json::from_str::<Theme>(&json).unwrap());
        }
        assert_eq!(
            serde_json::from_str::<Theme>("\"dark\"").unwrap(),
            Theme::Dark
        );
        assert_eq!(
            serde_json::from_str::<Theme>("\"light\"").unwrap(),
            Theme::Light
        );
        assert_eq!(
            serde_json::from_str::<Theme>("\"future-theme\"").unwrap(),
            Theme::Dark
        );
    }
}

