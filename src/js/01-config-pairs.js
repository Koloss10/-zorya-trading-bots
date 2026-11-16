
const VARIANT=2;

const N=26208,DEPTH=9000,PAIRS={},EXS={Binance:[125,100],Bybit:[100,100],OKX:[100,95],Bitget:[125,92],'Gate.io':[100,100],KuCoin:[100,90],MEXC:[200,100],BingX:[150,96],HTX:[100,85],BitMEX:[100,30]};
function rng(s){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function gs(R){let u=0;for(let i=0;i<6;i++)u+=R();return(u-3)*1.414}
function nextC(P,R){const o=P.c;if(R()<1/400)P.m=gs(R)*.0004;if(R()<1/3000)P.a*=1+gs(R)*.07;P.a*=1+P.v*.3*gs(R)+(P.m||0);const c=o*(1+P.v*gs(R)+.04*(P.a-o)/o),w=Math.abs(P.v*gs(R))*.6;P.c=c;const v=(P.vb||(P.vb=2e6/P.p))*(0.6+Math.abs(c/o-1)/P.v*0.9+Math.abs(gs(R))*0.5);return{o,h:Math.max(o,c)*(1+w),l:Math.min(o,c)*(1-w),c,v}}
[['BTC',60000,.006],['ETH',3000,.008],['SOL',150,.011],['BNB',580,.007],['XRP',.55,.01],['DOGE',.12,.014],['ADA',.45,.011],['AVAX',35,.012],['LINK',14,.011],['TON',6,.012],['DOT',7,.011],['LTC',80,.009]].forEach(([k,p,v],i)=>PAIRS[k+'/USDT']={p,v,s:i+1,f:95-i*3});
{const R=rng(7);'UNI,ETC,FIL,NEAR,APT,ARB,OP,INJ,SUI,SEI,TIA,RUNE,AAVE,MKR,SNX,CRV,LDO,ATOM,XLM,ALGO,VET,HBAR,ICP,EGLD,FTM,SAND,MANA,AXS,GALA,APE,CHZ,ENJ,FLOW,KAVA,ZIL,ONE,QTUM,IOTA,NEO,EOS,XTZ,THETA,GRT,1INCH,COMP,YFI,SUSHI,BAT,ZRX,KSM,WAVES,DASH,ZEC,XMR,BCH,BSV,TRX,SHIB,PEPE,FLOKI,BONK,WIF,JUP,PYTH,STRK,DYM,ORDI,WLD,RNDR,FET,AGIX,OCEAN,STX,IMX,GMX,DYDX,PENDLE,ENS,LRC,ANKR,CELO,ROSE,MINA,CFX,BLUR,JTO,MEME,ETHFI'.split(',').forEach((k,i)=>PAIRS[k+'/USDT']={p:+(10**(R()*4-1.5)).toPrecision(3),v:.007+R()*.02,s:i+100,f:Math.round(25+R()*50)})}
let PK=Object.keys(PAIRS);
