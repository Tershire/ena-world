---
title: "Past, Present, and Future of Simultaneous Localization and Mapping: Toward the Robust-Perception Age"
description: A comprehensive survey of SLAM covering open problems, metric and semantic representations, and robustness.
type: paper
authors: Cadena et al.
year: 2016
source: https://arxiv.org/abs/1606.05830
tags: [SLAM, survey, robustness, semantic-mapping]
public: true
date: 2024-03-10
order: 1
---

## Overview

IEEE Transactions on Robotics에 실린 SLAM 분야의 대표적인 서베이 논문. 20여 년간의 SLAM 연구를 정리하고, 당시 열린 문제들을 "robust-perception age"라는 키워드로 조망한다.

크게 세 시대로 나눈다:

1. **Classical age** (1986–2004): EKF-SLAM, particle filter 중심
2. **Algorithmic-analysis age** (2004–2015): 계산 복잡도·일관성 분석, 그래프 최적화 정착
3. **Robust-perception age** (2015–): 강인성, 의미론적 이해, 딥러닝 결합

---

## Key Points

### Front-end vs. Back-end

논문은 SLAM을 **front-end**(센서 데이터 → 관측 모델)와 **back-end**(최적화·추론)로 명확히 구분한다.

- Front-end: feature extraction, data association, loop closure detection
- Back-end: pose graph optimization (e.g., g²o, iSAM2), marginalization

### Open Problems at the Time

- **Long-term autonomy**: 환경 변화에 대한 지도 업데이트
- **Metric-semantic mapping**: 객체 수준의 의미 부여
- **Robustness**: outlier rejection, degenerate motion 대처
- **High-level understanding**: 장소 인식, 위상 지도

### Representation

포인트 클라우드, occupancy grid, surfel, mesh 등의 표현 방식을 비교하고, sparse vs. dense 지도의 트레이드오프를 정리한다.

---

## Notes

- 2016년 기준이므로 딥러닝 기반 SLAM (e.g., NeRF-SLAM, gaussian splatting)은 다루지 않음
- Data association 부분이 특히 상세하게 정리되어 있어 입문에 유용
- 인용 수가 매우 많아 분야 전반의 맥락을 잡는 데 좋은 출발점

## References

[1] Cadena, C., Carlone, L., Carrillo, H., Latif, Y., Scaramuzza, D., Neira, J., ... & Leonard, J. J. (2016). Past, present, and future of simultaneous localization and mapping: Toward the robust-perception age. *IEEE Transactions on Robotics*, 32(6), 1309–1332.
