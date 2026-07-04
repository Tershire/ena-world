---
title: Foxglove
description:
date: 2026-07-04
tags:
  - visualization
public: true
---
# definition

# install (Ubuntu)
-  컨테이너에 foxglove bridge 설치.
	- `sudo apt install ros-$ROS_DISTRO-foxglove-bridge`
		- $ROS_DISTRO는 예를 들어 ROS2 Jazzy인 경우 jazzy로 써주면 된다.
- Foxglove Studio 설치.
	- https://foxglove.dev/download
- Foxglove Web을 써도 된다지만 나의 경우 아직 web socket 연결 문제가 해결이 안 되었다. 

# how to use
## live visualization

- `ros2 launch foxglove_bridge foxglove_bridge_launch.xml port:=8765`

## example
Tech for People Lab에서 진행 중인 AQUA-SLAM의 경우 다음과 같은 순서다.
- 환경: Ubuntu
1. [터미널 1] (로컬 머신) X11 허가 (session당 1회)
	- `xhost +local:docker`
2. [터미널 2] (SLAM 컨테이너) Foxglove
	1. SLAM 컨테이너 실행
		- `docker exec -it aqua_slam_ros2_sim_dev bash`
	2. foxglove bridge 실행
		- `ros2 launch foxglove_bridge foxglove_bridge_launch.xml port:=8765`
3. [터미널 3] (SLAM 컨테이너) SLAM
	1. SLAM 컨테이너 실행
		- `docker exec -it aqua_slam_ros2_sim_dev bash`
	2. SLAM 실행
		- `ros2 launch aqua_slam stonefish_sim.launch.py`
4. [터미널 4] (시뮬레이션 컨테이너) Stonefish
	1. 시뮬레이션 컨테이너 실행
		- `docker exec -it aqua_slam_testbed bash`
	2. 시뮬레이션 실행
		- `ros2 launch /ros2_ws/launch/sim.launch.py`
5. [터미널 5] (시뮬레이션 명령) 사용자 명령
	1. 시뮬레이션 컨테이너 실행
		- `docker exec -it aqua_slam_testbed bash`
	2. 사용자 명령 실행
		- `python3 /ros2_ws/scripts/forward_test.py --thrust 0.3 --cruise 20 --ramp 3`