import { useEffect, useId, useMemo, useRef, useState } from 'react';

export const SOKOKUU_BRAND_LOGO_URL = '/sokokuu-brand-logo.svg';

const BLUE = '#0054A6';
const GREEN = '#10B981';

declare global {
  interface Window {
    __sokoKuuSplashActive?: boolean;
  }
}

/**
 * Authentic vector geometry traced directly from `public/sokokuu-brand-icon.png`
 * in a clean `0 0 240 240` viewBox, shared identically by SplashScreen and BrandLogo.
 */
const APP_ICON_ART = {
  upperBody:
    'M117.80,17.42 C121.05,17.35 124.40,17.44 127.64,17.72 C130.82,17.98 134.08,18.45 137.21,19.06 C140.33,19.66 143.52,20.47 146.56,21.38 C149.49,22.27 152.49,23.31 155.31,24.50 C158.62,25.90 161.95,27.55 165.13,29.22 C167.13,30.27 169.12,31.48 170.99,32.74 C174.03,34.79 177.12,36.96 179.99,39.24 C182.55,41.28 184.19,45.25 187.41,45.79 C200.30,47.97 213.93,46.62 226.98,47.18 C227.27,47.19 227.52,47.40 227.78,47.51 C227.64,47.65 227.55,47.90 227.36,47.93 C226.30,48.11 225.18,48.09 224.11,48.13 C216.79,48.41 209.24,48.74 201.91,48.90 C197.43,49.00 192.81,49.00 188.33,48.90 C175.57,48.62 162.43,47.97 149.67,47.75 C140.57,47.59 131.20,47.61 122.11,47.75 C118.88,47.80 115.56,47.95 112.36,48.34 C109.75,48.66 107.07,49.19 104.54,49.90 C101.83,50.66 99.10,51.70 96.49,52.76 C95.05,53.34 93.62,54.07 92.28,54.87 C90.16,56.12 87.97,57.43 86.04,58.96 C83.97,60.59 81.96,62.44 80.19,64.40 C78.50,66.28 76.98,68.41 75.61,70.54 C74.57,72.15 73.70,73.94 72.92,75.70 C72.22,77.27 71.63,78.96 71.14,80.62 C70.71,82.10 70.31,83.65 70.16,85.18 C69.92,87.44 69.87,89.79 69.95,92.06 C70.01,93.45 70.26,94.87 70.57,96.22 C70.97,97.96 71.44,99.74 72.10,101.39 C72.83,103.23 73.77,105.05 74.77,106.76 C75.50,108.01 76.42,109.20 77.33,110.32 C78.15,111.33 79.06,112.32 80.00,113.20 C81.11,114.25 82.32,115.26 83.55,116.16 C84.99,117.21 86.50,118.27 88.07,119.11 C91.24,120.80 94.58,122.43 97.90,123.83 C103.51,126.20 109.49,128.19 115.12,130.53 C116.59,131.14 118.03,131.94 119.39,132.76 C120.56,133.46 121.74,134.24 122.76,135.13 C123.71,135.95 124.61,136.90 125.35,137.91 C125.98,138.77 126.48,139.77 126.89,140.77 C127.28,141.71 127.59,142.73 127.74,143.74 C127.92,144.99 127.82,146.30 127.86,147.56 C128.32,146.47 128.97,145.41 129.24,144.26 C129.51,143.11 129.56,141.86 129.46,140.68 C129.36,139.47 129.11,138.21 128.67,137.08 C128.06,135.50 127.30,133.90 126.31,132.55 C124.74,130.42 122.91,128.37 120.96,126.60 C116.52,122.61 111.54,118.97 106.99,115.12 C105.04,113.47 103.02,111.78 101.26,109.94 C99.61,108.23 98.00,106.36 96.66,104.39 C95.50,102.70 94.49,100.81 93.73,98.91 C93.05,97.22 92.60,95.38 92.36,93.58 C92.15,92.02 92.23,90.38 92.36,88.82 C92.43,87.92 92.69,87.02 92.96,86.17 C93.27,85.19 93.64,84.20 94.10,83.28 C94.61,82.26 95.18,81.20 95.90,80.30 C97.01,78.90 98.29,77.56 99.63,76.37 C100.65,75.47 101.83,74.70 103.00,74.00 C104.17,73.30 105.43,72.65 106.70,72.15 C108.53,71.45 110.46,70.78 112.39,70.38 C114.55,69.92 116.83,69.61 119.04,69.57 C121.32,69.53 123.67,69.78 125.92,70.16 C127.97,70.49 130.06,71.01 132.02,71.72 C134.43,72.60 136.86,73.70 139.11,74.96 C141.09,76.07 143.02,77.42 144.77,78.86 C147.14,80.81 149.31,83.11 151.55,85.21 L168.41,70.32 C168.38,70.17 168.43,69.97 168.32,69.86 C167.25,68.72 165.96,67.74 164.88,66.60 C164.79,66.50 164.86,66.32 164.84,66.18 C169.43,65.90 174.16,65.70 178.74,65.35 C181.47,65.14 184.26,64.77 186.98,64.49 C186.85,64.40 186.75,64.24 186.59,64.22 C184.26,64.02 181.86,63.92 179.52,63.83 C173.59,63.60 167.38,64.34 161.54,63.24 C159.31,62.82 157.72,60.66 155.84,59.38 L155.85,59.10 C169.60,58.64 183.76,58.00 197.51,57.70 C197.84,57.70 198.16,57.94 198.37,58.18 C199.32,59.27 200.13,60.52 201.00,61.68 C206.60,61.95 212.38,62.14 217.98,62.50 C219.00,62.57 220.03,62.81 221.03,62.97 C219.77,63.12 218.48,63.35 217.21,63.43 C212.42,63.74 207.48,63.90 202.68,64.13 C203.97,66.35 205.39,68.57 206.57,70.85 C208.17,73.94 209.60,77.23 211.10,80.37 C207.88,80.41 204.56,80.35 201.35,80.49 C200.47,80.53 199.56,80.69 198.70,80.90 C196.72,81.40 194.68,81.92 192.77,82.63 C190.94,83.31 189.12,84.19 187.40,85.10 C186.11,85.79 184.84,86.62 183.65,87.47 C182.30,88.44 180.96,89.53 179.71,90.62 C178.81,91.42 177.94,92.31 177.13,93.21 C176.23,94.21 175.34,95.28 174.56,96.37 C173.65,97.63 172.77,98.98 171.99,100.32 C171.38,101.38 170.81,102.51 170.34,103.64 C169.74,105.04 169.18,106.52 168.75,107.99 C168.32,109.47 168.01,111.03 167.76,112.55 C167.55,113.86 167.34,115.23 167.37,116.56 C167.43,119.47 167.81,122.45 168.02,125.35 C167.08,123.62 166.21,121.77 165.16,120.11 C164.19,118.58 163.06,117.09 161.90,115.70 C160.73,114.30 159.41,112.94 158.08,111.68 C157.04,110.69 155.91,109.72 154.73,108.91 C152.11,107.13 149.41,105.26 146.57,103.86 C140.43,100.83 133.80,98.33 127.56,95.50 C126.24,94.90 124.91,94.21 123.67,93.46 C122.22,92.59 120.74,91.67 119.43,90.62 C118.45,89.84 117.55,88.90 116.76,87.93 C116.15,87.19 115.61,86.33 115.22,85.45 C114.76,84.44 114.42,83.34 114.21,82.25 C113.95,80.97 113.92,79.61 113.78,78.30 C113.34,79.50 112.67,80.67 112.45,81.93 C112.23,83.22 112.27,84.62 112.45,85.92 C112.62,87.13 113.00,88.36 113.49,89.47 C114.11,90.87 114.86,92.28 115.80,93.48 C117.34,95.46 119.11,97.36 120.96,99.04 C125.17,102.87 129.87,106.40 134.16,110.15 C136.38,112.09 138.61,114.16 140.67,116.27 C141.70,117.33 142.70,118.50 143.53,119.72 C144.72,121.48 145.83,123.37 146.79,125.26 C147.31,126.27 147.68,127.38 147.99,128.46 C148.34,129.63 148.62,130.86 148.79,132.07 C148.95,133.13 149.02,134.24 148.99,135.31 C148.96,136.45 148.80,137.62 148.60,138.74 C148.47,139.51 148.26,140.28 147.99,141.01 C147.56,142.18 147.13,143.41 146.47,144.46 C145.52,146.00 144.39,147.49 143.16,148.80 C142.23,149.78 141.09,150.60 139.99,151.38 C139.05,152.04 138.06,152.71 137.00,153.17 C134.65,154.19 132.20,155.22 129.72,155.84 C127.32,156.44 124.76,156.69 122.30,156.84 C120.47,156.95 118.58,156.79 116.76,156.64 C115.55,156.54 114.30,156.36 113.12,156.06 C110.66,155.45 108.09,154.85 105.74,153.87 C103.11,152.78 100.52,151.36 98.10,149.85 C96.30,148.73 94.56,147.38 93.02,145.93 C90.16,143.26 87.50,140.22 84.78,137.41 L65.86,152.82 C67.27,154.37 68.79,155.91 70.14,157.51 C70.52,157.96 70.77,158.53 71.09,159.03 C66.07,159.32 60.90,159.54 55.90,159.92 C53.30,160.11 50.64,160.49 48.06,160.77 C56.70,161.12 65.70,160.50 74.25,161.83 C76.20,162.13 77.39,164.33 78.94,165.56 L78.98,165.97 C64.42,165.99 49.40,166.17 34.83,166.03 C28.87,165.97 22.73,165.57 16.76,165.35 L17.05,164.89 L37.35,163.59 C36.12,161.38 34.78,159.15 33.62,156.90 C32.43,154.58 31.21,152.18 30.24,149.76 C28.75,146.04 27.37,142.15 26.17,138.33 C25.51,136.23 25.01,134.01 24.61,131.85 C24.05,128.90 23.48,125.85 23.27,122.86 C22.97,118.58 22.98,114.15 23.06,109.86 C23.11,107.71 23.35,105.49 23.65,103.36 C24.06,100.39 24.51,97.32 25.21,94.40 C26.16,90.43 27.36,86.40 28.65,82.53 C29.47,80.09 30.53,77.66 31.58,75.31 C32.55,73.17 33.60,70.98 34.77,68.93 C36.64,65.67 38.62,62.32 40.78,59.24 C42.97,56.12 45.41,53.00 47.94,50.15 C50.46,47.31 53.24,44.53 56.08,42.01 C58.94,39.47 62.04,37.02 65.18,34.84 C68.50,32.54 72.06,30.35 75.63,28.45 C79.00,26.66 82.61,25.06 86.17,23.68 C89.44,22.41 92.90,21.28 96.31,20.43 C100.23,19.44 104.33,18.66 108.34,18.10 C111.44,17.66 114.67,17.48 117.80,17.42 Z',
  lowerBody:
    'M170.09,133.66 C171.16,135.77 172.15,138.01 173.33,140.06 C174.20,141.56 175.19,143.05 176.28,144.39 C177.80,146.26 179.49,148.11 181.25,149.76 C182.56,150.99 184.04,152.13 185.56,153.10 C187.56,154.38 189.72,155.55 191.87,156.55 C193.43,157.28 195.13,157.87 196.79,158.33 C198.90,158.91 201.10,159.40 203.27,159.70 C204.89,159.93 206.59,159.73 208.22,159.92 C208.39,159.94 208.47,160.17 208.60,160.30 C207.34,162.37 206.16,164.59 204.77,166.59 C202.90,169.30 200.91,172.06 198.75,174.54 C195.89,177.85 192.69,181.04 189.57,184.11 C188.20,185.47 186.65,186.72 185.16,187.93 C182.99,189.69 180.76,191.51 178.46,193.10 C175.41,195.21 172.17,197.25 168.96,199.11 C166.48,200.54 163.85,201.88 161.24,203.06 C158.28,204.40 155.17,205.65 152.11,206.75 C149.31,207.76 146.37,208.65 143.50,209.43 C141.20,210.05 138.79,210.55 136.45,210.99 C134.38,211.38 132.23,211.72 130.13,211.95 C127.49,212.23 124.76,212.47 122.10,212.53 C119.58,212.60 116.98,212.48 114.46,212.33 C112.69,212.23 110.85,212.07 109.10,211.76 C105.05,211.04 100.89,210.19 96.89,209.24 C95.02,208.79 93.14,208.17 91.34,207.52 C88.73,206.57 86.07,205.53 83.54,204.40 C81.26,203.38 78.97,202.22 76.78,201.02 C74.36,199.69 71.90,198.25 69.58,196.74 C67.30,195.25 65.03,193.61 62.88,191.95 C60.89,190.42 58.88,188.79 57.03,187.08 C54.58,184.81 52.15,182.34 49.86,179.90 C48.66,178.63 47.59,177.19 46.47,175.85 C46.61,175.77 46.73,175.60 46.89,175.60 C49.16,175.58 51.51,175.67 53.78,175.79 C70.58,176.68 87.88,177.87 104.69,178.66 C109.30,178.88 114.05,178.85 118.66,178.85 C120.93,178.85 123.27,178.80 125.54,178.65 C127.19,178.54 128.89,178.36 130.51,178.07 C132.61,177.71 134.74,177.23 136.80,176.70 C138.21,176.34 139.65,175.90 141.01,175.36 C143.20,174.51 145.46,173.62 147.53,172.50 C149.94,171.19 152.33,169.66 154.53,168.03 C156.16,166.83 157.71,165.44 159.10,163.98 C160.85,162.11 162.56,160.09 164.01,157.98 C165.27,156.14 166.34,154.09 167.27,152.06 C168.07,150.30 168.75,148.42 169.24,146.56 C169.73,144.71 170.10,142.76 170.23,140.85 C170.38,138.48 170.14,136.03 170.09,133.66 Z',
  bottomStreak:
    'M40.20,167.48 C54.27,168.01 68.78,168.50 82.86,169.10 C83.47,169.13 84.14,169.11 84.69,169.38 C87.33,170.67 89.88,172.32 92.43,173.77 C74.25,173.74 55.51,173.88 37.32,173.68 C29.11,173.59 20.66,173.25 12.45,172.91 C12.29,172.90 12.18,172.72 12.05,172.63 C12.18,172.54 12.29,172.38 12.45,172.36 C14.02,172.15 15.65,172.03 17.23,171.96 C25.49,171.64 34.01,171.44 42.28,171.18 L42.47,170.82 L40.20,167.48 Z',
  topStreak:
    'M187.85,50.33 C189.11,50.30 190.40,50.34 191.66,50.35 C192.90,51.63 193.67,53.90 195.42,54.25 C202.29,55.60 209.62,54.85 216.61,55.26 C216.83,55.27 217.02,55.43 217.22,55.51 C217.09,55.60 216.98,55.77 216.83,55.78 C213.11,56.05 209.27,56.23 205.55,56.36 C202.08,56.49 198.50,56.58 195.02,56.56 C180.88,56.45 166.31,56.24 152.17,55.97 C151.30,55.95 150.37,56.01 149.57,55.69 C146.92,54.64 144.38,53.14 141.82,51.88 C157.01,51.37 172.66,50.80 187.85,50.33 Z',
} as const;

/** Wordmark + tagline paths from `public/sokokuu-brand-logo.svg`. */
const WORDMARK_ART = {
  wordBlue:
    'M810,719 L797,726 L785,737 L778,747 L774,756 L772,766 L771,767 L770,783 L771,784 L771,793 L772,794 L773,801 L778,813 L786,824 L792,830 L802,837 L810,841 L819,844 L828,845 L829,846 L854,846 L855,845 L864,844 L877,839 L888,832 L897,823 L904,813 L909,801 L909,798 L911,793 L911,786 L912,785 L912,776 L911,775 L911,767 L910,766 L909,759 L905,751 L905,749 L895,735 L886,727 L872,719 L863,716 L855,715 L854,714 L829,714 L828,715 L819,716Z  M833,744 L848,744 L854,746 L861,750 L869,759 L874,774 L874,787 L873,788 L873,791 L871,797 L868,802 L857,812 L849,815 L845,815 L844,816 L832,815 L823,811 L813,800 L812,797 L810,795 L809,789 L808,788 L808,771 L813,759 L822,749Z  M573,717 L565,716 L560,714 L547,713 L546,714 L529,715 L528,716 L524,716 L518,719 L516,719 L508,723 L497,731 L486,744 L481,754 L479,760 L479,763 L478,764 L478,767 L477,768 L477,792 L478,793 L479,800 L482,806 L482,808 L489,820 L496,828 L505,835 L518,842 L528,844 L529,845 L534,845 L535,846 L559,846 L560,845 L565,845 L566,844 L569,844 L578,841 L588,836 L596,830 L607,818 L612,809 L612,807 L615,801 L616,794 L617,793 L617,785 L618,784 L617,768 L616,767 L615,760 L612,754 L612,752 L604,739 L597,731 L586,723Z  M539,744 L554,744 L562,747 L568,751 L573,756 L579,768 L579,772 L580,773 L580,789 L579,790 L579,793 L574,802 L566,810 L556,815 L545,816 L544,815 L538,815 L535,813 L531,812 L519,801 L514,789 L514,785 L513,784 L513,774 L514,773 L515,767 L520,757 L528,749 L533,746Z  M637,667 L636,668 L636,844 L673,844 L673,812 L690,794 L693,796 L704,812 L710,819 L712,823 L729,844 L773,844 L765,832 L761,828 L740,799 L732,790 L718,771 L718,768 L720,767 L720,766 L762,723 L768,715 L726,715 L724,716 L691,749 L690,749 L675,765 L673,762 L673,668 L672,667Z ',
  wordGreen:
    'M1254,715 L1254,803 L1255,804 L1255,808 L1257,812 L1257,815 L1262,825 L1271,835 L1280,841 L1284,842 L1287,844 L1294,845 L1295,846 L1301,846 L1302,847 L1317,847 L1318,846 L1326,845 L1332,842 L1334,842 L1342,837 L1346,833 L1349,834 L1349,843 L1350,845 L1384,845 L1385,844 L1385,715 L1348,715 L1347,716 L1347,789 L1346,790 L1346,793 L1341,803 L1335,809 L1327,813 L1322,813 L1321,814 L1309,813 L1303,810 L1297,804 L1293,795 L1293,792 L1292,791 L1292,716 L1291,715Z  M1096,716 L1096,800 L1097,801 L1098,810 L1103,822 L1107,828 L1115,836 L1125,842 L1134,845 L1137,845 L1138,846 L1143,846 L1144,847 L1160,847 L1161,846 L1165,846 L1177,842 L1187,834 L1191,832 L1193,836 L1193,844 L1194,845 L1227,845 L1228,844 L1228,715 L1191,715 L1190,716 L1190,785 L1189,786 L1189,791 L1187,797 L1184,802 L1177,809 L1168,813 L1153,813 L1147,811 L1139,804 L1136,798 L1135,791 L1134,790 L1134,715 L1097,715Z  M933,675 L932,676 L932,682 L931,683 L931,694 L932,695 L932,845 L970,845 L971,844 L971,802 L992,780 L994,780 L1017,810 L1041,840 L1046,845 L1091,845 L1090,841 L1081,829 L1073,820 L1034,768 L1020,751 L1020,750 L1058,710 L1069,697 L1083,683 L1087,678 L1088,675 L1044,675 L1042,676 L1042,677 L1028,691 L1019,702 L1003,718 L1003,719 L974,750 L971,749 L971,676 L970,675Z ',
  tagBlue:
    'M1379,901 L1378,902 L1378,942 L1383,942 L1383,910 L1384,909 L1384,903 L1383,901Z  M1335,901 L1334,903 L1334,917 L1335,918 L1335,937 L1334,939 L1335,942 L1340,942 L1340,902 L1339,901Z  M1318,901 L1314,901 L1313,902 L1313,948 L1309,953 L1299,953 L1298,955 L1299,957 L1301,958 L1312,958 L1317,954 L1318,951 L1318,946 L1319,945 L1319,902Z  M1205,901 L1205,942 L1210,942 L1210,901Z  M999,901 L999,905 L1021,905 L1022,908 L999,937 L998,941 L999,942 L1032,942 L1032,938 L1008,938 L1007,937 L1007,935 L1031,905 L1032,903 L1031,901Z  M770,901 L769,902 L770,932 L773,938 L779,942 L789,943 L795,941 L800,937 L802,942 L806,942 L807,941 L807,902 L806,901 L801,901 L801,928 L799,932 L794,937 L791,938 L784,938 L780,936 L777,933 L775,929 L775,925 L774,924 L774,910 L775,909 L774,905 L775,903 L774,901Z  M664,901 L663,902 L663,929 L665,935 L670,940 L674,942 L679,942 L680,943 L681,942 L686,942 L689,941 L694,937 L696,938 L696,942 L701,942 L701,902 L700,901 L696,901 L695,902 L696,922 L695,923 L695,928 L693,932 L689,936 L685,938 L678,938 L672,934 L669,928 L669,901Z  M1265,904 L1264,905 L1265,909 L1268,909 L1270,907 L1275,905 L1284,905 L1290,910 L1292,914 L1292,917 L1290,919 L1273,919 L1267,921 L1263,925 L1263,928 L1262,929 L1263,936 L1267,940 L1275,943 L1284,942 L1287,941 L1290,938 L1292,939 L1293,942 L1297,942 L1297,913 L1296,912 L1296,909 L1293,904 L1290,902 L1284,901 L1283,900 L1276,900Z  M1268,929 L1269,927 L1274,923 L1290,923 L1292,927 L1290,933 L1286,937 L1284,938 L1279,938 L1278,939 L1273,938 L1269,934Z  M1236,900 L1235,901 L1229,902 L1224,906 L1223,908 L1223,916 L1227,921 L1229,921 L1232,923 L1240,924 L1246,926 L1249,930 L1249,933 L1247,936 L1243,938 L1233,938 L1227,936 L1225,934 L1223,934 L1221,937 L1226,941 L1240,943 L1241,942 L1246,942 L1250,940 L1254,936 L1254,927 L1249,921 L1240,920 L1231,917 L1228,914 L1228,910 L1234,905 L1244,905 L1250,908 L1252,906 L1252,903 L1248,901Z  M1043,904 L1042,907 L1044,909 L1046,909 L1052,905 L1062,905 L1064,906 L1069,912 L1069,918 L1068,919 L1050,919 L1045,921 L1042,924 L1040,929 L1040,933 L1043,939 L1052,943 L1058,943 L1059,942 L1062,942 L1068,938 L1070,940 L1070,942 L1074,942 L1075,941 L1075,911 L1074,908 L1068,902 L1062,900 L1050,901Z  M1046,929 L1051,923 L1068,923 L1070,925 L1068,933 L1064,937 L1059,939 L1054,939 L1049,937 L1046,933Z  M822,904 L821,905 L822,909 L824,909 L826,907 L831,905 L841,905 L847,910 L848,912 L848,917 L846,919 L830,919 L824,921 L819,927 L819,934 L821,938 L823,940 L831,943 L841,942 L847,938 L849,940 L849,942 L853,942 L854,941 L854,913 L852,907 L848,903 L841,900 L832,900Z  M824,928 L830,923 L847,923 L848,924 L848,931 L847,933 L843,937 L837,939 L829,938 L825,934 L824,932Z  M717,901 L716,902 L716,909 L717,910 L716,935 L717,936 L717,942 L721,942 L722,941 L722,916 L724,912 L729,907 L734,905 L740,905 L743,906 L748,911 L749,914 L749,942 L754,942 L755,940 L755,932 L754,931 L754,911 L751,905 L749,903 L741,900 L731,901 L725,905 L723,905 L721,901Z  M1162,887 L1162,891 L1163,892 L1181,892 L1183,894 L1183,928 L1182,929 L1182,932 L1179,936 L1175,938 L1168,938 L1161,932 L1159,932 L1157,935 L1158,938 L1164,942 L1167,942 L1168,943 L1176,943 L1183,940 L1186,937 L1188,932 L1188,887Z  M942,887 L942,927 L945,934 L951,940 L960,943 L967,943 L968,942 L972,942 L977,940 L983,934 L986,927 L986,887 L981,887 L981,923 L980,924 L980,927 L978,931 L973,936 L968,938 L960,938 L957,937 L950,931 L947,923 L947,887Z  M602,887 L602,942 L607,942 L607,902 L609,900 L617,911 L630,926 L639,939 L642,942 L647,942 L647,887 L642,887 L641,888 L641,928 L640,929 L635,924 L607,887Z  M1357,884 L1356,885 L1356,941 L1357,942 L1361,942 L1362,941 L1362,884Z  M1380,883 L1377,885 L1377,889 L1379,891 L1382,891 L1385,889 L1385,886 L1382,883Z  M1334,884 L1333,889 L1336,891 L1339,891 L1342,887 L1339,883Z  M1314,883 L1312,885 L1311,888 L1314,891 L1319,890 L1320,889 L1319,884Z  M1206,883 L1204,885 L1204,889 L1207,891 L1211,890 L1212,886 L1209,883Z ',
  tagGreen:
    'M1117,904 L1110,907 L1108,909 L1105,916 L1105,921 L1108,928 L1110,930 L1117,933 L1121,933 L1128,930 L1132,926 L1133,923 L1133,914 L1131,910 L1128,907 L1121,904Z  M897,904 L889,907 L885,911 L883,919 L884,920 L884,924 L885,926 L890,931 L896,933 L899,933 L905,931 L910,926 L912,921 L912,917 L910,911 L905,906Z ',
} as const;

interface LetterGlyph {
  key: string;
  d: string;
  color: string;
  delayMs: number;
  durationMs: number;
}

function splitSubpaths(d: string): string[] {
  return d
    .split(/(?=M)/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function buildBrandGlyphs(): { wordGlyphs: LetterGlyph[]; tagGlyphs: LetterGlyph[] } {
  const wb = splitSubpaths(WORDMARK_ART.wordBlue);
  const wg = splitSubpaths(WORDMARK_ART.wordGreen);
  const tb = splitSubpaths(WORDMARK_ART.tagBlue);
  const tg = splitSubpaths(WORDMARK_ART.tagGreen);

  // Wordmark sequence starts right as the app-icon color sweep completes (~3.05s):
  // o -> k -> o -> K -> u -> u
  const wordGlyphs: LetterGlyph[] = [
    { key: 'w-o1', d: `${wb[2]} ${wb[3]}`, color: BLUE,  delayMs: 3050, durationMs: 680 },
    { key: 'w-k',  d: wb[4],               color: BLUE,  delayMs: 3480, durationMs: 680 },
    { key: 'w-o2', d: `${wb[0]} ${wb[1]}`, color: BLUE,  delayMs: 3910, durationMs: 680 },
    { key: 'w-K',  d: wg[2],               color: GREEN, delayMs: 4340, durationMs: 700 },
    { key: 'w-u1', d: wg[1],               color: GREEN, delayMs: 4780, durationMs: 660 },
    { key: 'w-u2', d: wg[0],               color: GREEN, delayMs: 5200, durationMs: 660 },
  ];

  // Tagline sequence left-to-right: N u n u a • U z a • J i s a j i l i
  const tagSpecs: Array<{ key: string; d: string; color: string }> = [
    { key: 't-N',    d: tb[17],                color: BLUE },
    { key: 't-u1',   d: tb[6],                 color: BLUE },
    { key: 't-n',    d: tb[14],                color: BLUE },
    { key: 't-u2',   d: tb[5],                 color: BLUE },
    { key: 't-a1',   d: `${tb[12]} ${tb[13]}`, color: BLUE },
    { key: 't-dot1', d: tg[1],                 color: GREEN },
    { key: 't-U',    d: tb[16],                color: BLUE },
    { key: 't-z',    d: tb[4],                 color: BLUE },
    { key: 't-a2',   d: `${tb[10]} ${tb[11]}`, color: BLUE },
    { key: 't-dot2', d: tg[0],                 color: GREEN },
    { key: 't-J',    d: tb[15],                color: BLUE },
    { key: 't-i1',   d: `${tb[3]} ${tb[22]}`,  color: BLUE },
    { key: 't-s',    d: tb[9],                 color: BLUE },
    { key: 't-a3',   d: `${tb[7]} ${tb[8]}`,   color: BLUE },
    { key: 't-j',    d: `${tb[2]} ${tb[21]}`,  color: BLUE },
    { key: 't-i2',   d: `${tb[1]} ${tb[20]}`,  color: BLUE },
    { key: 't-l',    d: tb[18],                color: BLUE },
    { key: 't-i3',   d: `${tb[0]} ${tb[19]}`,  color: BLUE },
  ];

  const tagGlyphs: LetterGlyph[] = tagSpecs.map((spec, index) => ({
    ...spec,
    delayMs: 5680 + index * 110,
    durationMs: 540,
  }));

  return { wordGlyphs, tagGlyphs };
}

/**
 * Shared SVG <defs> + fill/stroke layers for the exact `sokokuu-brand-icon.png` emblem.
 * Draws purely by stroke (zero fill) first, then smoothly reveals the emerald fill sweep.
 */
function AppIconDefs({ gradId, clipId, animated }: { gradId: string; clipId: string; animated: boolean }) {
  return (
    <defs>
      <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#02C83B" />
        <stop offset="55%" stopColor="#02BC37" />
        <stop offset="100%" stopColor="#02A831" />
      </linearGradient>
      <clipPath id={clipId}>
        <rect
          x="0"
          y="0"
          width="240"
          height="240"
          className={animated ? 'sk-appicon-sweep-rect' : ''}
        />
      </clipPath>
    </defs>
  );
}

function AppIconLayers({
  gradId,
  clipId,
  animated,
}: {
  gradId: string;
  clipId: string;
  animated: boolean;
}) {
  return (
    <>
      {/* Color-revealed fill layer: stays hidden until pure stroke drawing completes */}
      <g clipPath={`url(#${clipId})`} className={animated ? 'sk-appicon-fill' : ''}>
        <path d={APP_ICON_ART.upperBody} fill={`url(#${gradId})`} />
        <path d={APP_ICON_ART.lowerBody} fill={`url(#${gradId})`} />
        <path d={APP_ICON_ART.topStreak} fill={`url(#${gradId})`} />
        <path d={APP_ICON_ART.bottomStreak} fill={`url(#${gradId})`} />
      </g>

      {/* Pure stroke drawing layer (zero fill while drawing; fades out once color reveals) */}
      {animated && (
        <g
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="sk-appicon-stroke-layer"
        >
          <path
            d={APP_ICON_ART.upperBody}
            pathLength={1000}
            stroke="#02BC37"
            strokeWidth={2.0}
            className="sk-appicon-stroke sk-appicon-stroke-main"
          />
          <path
            d={APP_ICON_ART.lowerBody}
            pathLength={1000}
            stroke="#02BC37"
            strokeWidth={2.0}
            className="sk-appicon-stroke sk-appicon-stroke-lower"
          />
          <path
            d={APP_ICON_ART.topStreak}
            pathLength={1000}
            stroke="#02BC37"
            strokeWidth={1.6}
            className="sk-appicon-stroke sk-appicon-stroke-streak"
            style={{ animationDelay: '1.25s' }}
          />
          <path
            d={APP_ICON_ART.bottomStreak}
            pathLength={1000}
            stroke="#02BC37"
            strokeWidth={1.6}
            className="sk-appicon-stroke sk-appicon-stroke-streak"
            style={{ animationDelay: '1.38s' }}
          />
        </g>
      )}
    </>
  );
}

/**
 * Vector SokoKuu App Icon (`sokokuu-brand-icon.png` / PWA launcher emblem).
 * Splash sequence: draws the S & emblem purely with stroke (zero fill),
 * then smoothly reveals the emerald color fill once drawing finishes.
 */
export function SokoKuuAppIcon({
  sizeClass = 'w-32 h-32',
  animated = true,
}: {
  sizeClass?: string;
  animated?: boolean;
}) {
  const uid = useId().replace(/:/g, '');
  const gradId = `sk-app-grad-${uid}`;
  const clipId = `sk-app-clip-${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 240 240"
      role="img"
      aria-label="SokoKuu App Icon"
      shapeRendering="geometricPrecision"
      className={`${sizeClass} select-none overflow-visible`}
    >
      <AppIconDefs gradId={gradId} clipId={clipId} animated={animated} />
      <AppIconLayers gradId={gradId} clipId={clipId} animated={animated} />
    </svg>
  );
}

/**
 * Animated inline brand logo:
 * 1) Draws the identical SokoKuu App Icon with the exact splash stroke -> fill sequence.
 * 2) Draws and fills each wordmark letter sequentially: o -> k -> o -> K -> u -> u.
 * 3) Draws and fills the tagline letter-by-letter: Nunua • Uza • Jisajili.
 * Waits for splash dismissal on first load, and replays on hover.
 */
export function BrandLogo({
  size = 'md',
  showWordmark = true,
  subtitle,
}: {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showWordmark?: boolean;
  subtitle?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const gradId = `sk-brand-grad-${uid}`;
  const clipId = `sk-brand-clip-${uid}`;

  const [waitingForSplash, setWaitingForSplash] = useState(() =>
    typeof window !== 'undefined' ? Boolean(window.__sokoKuuSplashActive) : false,
  );
  const [replayKey, setReplayKey] = useState(0);
  const [closing, setClosing] = useState(false);
  const replayTimer = useRef<number | null>(null);

  const { wordGlyphs, tagGlyphs } = useMemo(() => buildBrandGlyphs(), []);

  useEffect(() => {
    if (!waitingForSplash) return;
    const onSplashDone = () => {
      setWaitingForSplash(false);
      setReplayKey((key) => key + 1);
    };
    window.addEventListener('sokokuu:splash-done', onSplashDone, { once: true });
    return () => {
      window.removeEventListener('sokokuu:splash-done', onSplashDone);
    };
  }, [waitingForSplash]);

  useEffect(
    () => () => {
      if (replayTimer.current !== null) window.clearTimeout(replayTimer.current);
    },
    [],
  );

  const replay = () => {
    if (waitingForSplash || replayTimer.current !== null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setClosing(true);
    replayTimer.current = window.setTimeout(() => {
      setReplayKey((key) => key + 1);
      setClosing(false);
      replayTimer.current = null;
    }, 150);
  };

  const heightClass =
    size === 'sm'
      ? 'h-10'
      : size === 'lg'
        ? 'h-20'
        : size === 'xl'
          ? 'h-28'
          : 'h-14';

  const shouldAnimate = !waitingForSplash;

  return (
    <span
      className={`sk-logo-wrap inline-flex flex-col items-start shrink-0 leading-none${closing ? ' sk-logo-closing' : ''}`}
      onPointerEnter={replay}
    >
      <svg
        key={replayKey}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="112 552 1286 432"
        role="img"
        aria-label="SokoKuu — Nunua • Uza • Jisajili"
        shapeRendering="geometricPrecision"
        className={`${heightClass} w-auto max-w-[360px] select-none`}
      >
        <AppIconDefs gradId={gradId} clipId={clipId} animated={shouldAnimate} />

        {/* 1. Authentic SokoKuu App Icon: exact splash stroke -> emerald fill sequence */}
        <g
          className="sk-brand-group sk-brand-icon"
          transform="translate(96, 531) scale(2.08)"
          style={waitingForSplash ? { opacity: 0 } : undefined}
        >
          <AppIconLayers gradId={gradId} clipId={clipId} animated={shouldAnimate} />
        </g>

        {/* 2. Wordmark letters drawn and painted one by one: o -> k -> o -> K -> u -> u */}
        <g className="sk-brand-group sk-brand-word">
          {shouldAnimate &&
            wordGlyphs.map((glyph) => (
              <path
                key={glyph.key}
                d={glyph.d}
                pathLength={1000}
                fill={glyph.color}
                fillRule="evenodd"
                stroke={glyph.color}
                strokeWidth={3.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="sk-brand-path sk-brand-path-letter"
                style={{
                  animationDelay: `${glyph.delayMs}ms`,
                  animationDuration: `${glyph.durationMs}ms`,
                }}
              />
            ))}
        </g>

        {/* 3. Tagline letters drawn and painted sequentially: Nunua • Uza • Jisajili */}
        <g className="sk-brand-group sk-brand-tag">
          {shouldAnimate &&
            tagGlyphs.map((glyph) => (
              <path
                key={glyph.key}
                d={glyph.d}
                pathLength={1000}
                fill={glyph.color}
                fillRule="evenodd"
                stroke={glyph.color}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="sk-brand-path sk-brand-path-letter"
                style={{
                  animationDelay: `${glyph.delayMs}ms`,
                  animationDuration: `${glyph.durationMs}ms`,
                }}
              />
            ))}
        </g>
      </svg>

      {showWordmark && subtitle && (
        <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap mt-1">
          {subtitle}
        </span>
      )}
    </span>
  );
}

export default BrandLogo;